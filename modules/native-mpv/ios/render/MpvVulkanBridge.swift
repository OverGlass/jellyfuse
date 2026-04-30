//
//  MpvVulkanBridge.swift
//  @jellyfuse/native-mpv — Phase 1 render rewrite
//
//  Brings up MoltenVK on top of an MTLDevice. Exposes a graphics-capable
//  VkInstance / VkPhysicalDevice / VkDevice / VkQueue that we hand to
//  libmpv via `mpv_vulkan_init_params`. Imports IOSurface-backed
//  MTLTextures as VkImages via `VK_EXT_metal_objects` so the renderer
//  writes straight into the same surface we wrap as a CMSampleBuffer
//  for AVSampleBufferDisplayLayer.
//
//  Lifecycle: one bridge per `MpvMetalView` (i.e. one per player
//  session). Tear-down order matters — the mpv render context holds a
//  pl_vulkan handle that imports our VkDevice, so the render context
//  must be destroyed before the bridge.
//

import Foundation
import IOSurface
import Libmpv
import Metal
import Vulkan

// MARK: - Errors

enum MpvVulkanBridgeError: Error, CustomStringConvertible {
    case vk(VkResult, String)
    case noPhysicalDevice
    case noGraphicsQueue
    case noSuitableMemoryType

    var description: String {
        switch self {
        case .vk(let rc, let where_):
            return "Vulkan error \(rc.rawValue) in \(where_)"
        case .noPhysicalDevice: return "No Vulkan physical device available"
        case .noGraphicsQueue: return "No graphics-capable queue family"
        case .noSuitableMemoryType:
            return "No suitable memory type available for IOSurface-backed VkImage"
        }
    }
}

/// Owned pair returned from `makeImageFromIOSurface`. Both must be
/// released together via `destroyImage(_:)` — the VkImage holds a
/// reference to the IOSurface and the VkDeviceMemory holds the storage
/// mode hint MoltenVK reads to satisfy iOS 17+ Metal validation.
struct MpvIOSurfaceVkImage {
    let image: VkImage
    let memory: VkDeviceMemory
}

// MARK: - MpvVulkanBridge

/// Owns the Vulkan handles for one player session. All work happens on
/// the render queue belonging to `MpvMetalView`; the bridge itself does
/// not synchronize. The renderer must hold exclusive access to the
/// VkDevice while inside `mpv_render_context_render`.
final class MpvVulkanBridge {

    let metalDevice: MTLDevice
    let instance: VkInstance
    let physicalDevice: VkPhysicalDevice
    let device: VkDevice
    let queue: VkQueue
    let queueFamilyIndex: UInt32
    let queueIndex: UInt32

    init(metalDevice: MTLDevice, debug: Bool = false) throws {
        self.metalDevice = metalDevice

        // ── 1. Instance ───────────────────────────────────────────────
        // iOS has a single Apple GPU and no "non-conformant" Vulkan
        // implementations, so `VK_KHR_portability_enumeration` (a
        // macOS multi-GPU instance extension) isn't exposed by MoltenVK
        // and the `ENUMERATE_PORTABILITY_BIT` flag must stay clear.
        // `VK_EXT_metal_objects` is a *device* extension on MoltenVK —
        // requested below in `deviceExts`, not here.
        // `VK_KHR_external_memory_capabilities` is the instance-level
        // half of `VK_KHR_external_memory`; it's the only thing we
        // need at instance scope for the IOSurface import path.
        let instanceExts: [String] = [
            "VK_KHR_get_physical_device_properties2",
            "VK_KHR_external_memory_capabilities",
        ]

        // Vulkan reads `pApplicationName`, `pEngineName`, and `pApplicationInfo`
        // during the call — they must outlive `vkCreateInstance`. Nest the
        // pointer scopes so each cString / VkApplicationInfo storage stays
        // alive for the duration.
        var instance: VkInstance? = nil
        try "Jellyfuse".withCString { appNamePtr in
            try "mpv-apple".withCString { engineNamePtr in
                let appInfo = VkApplicationInfo(
                    sType: VK_STRUCTURE_TYPE_APPLICATION_INFO,
                    pNext: nil,
                    pApplicationName: appNamePtr,
                    applicationVersion: 1,
                    pEngineName: engineNamePtr,
                    engineVersion: 1,
                    apiVersion: UInt32((1 << 22) | (2 << 12)) // VK_API_VERSION_1_2
                )
                try withUnsafePointer(to: appInfo) { appInfoPtr in
                    try withCStrings(instanceExts) { extPtrs in
                        var info = VkInstanceCreateInfo(
                            sType: VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO,
                            pNext: nil,
                            flags: 0,
                            pApplicationInfo: appInfoPtr,
                            enabledLayerCount: 0,
                            ppEnabledLayerNames: nil,
                            enabledExtensionCount: UInt32(extPtrs.count),
                            ppEnabledExtensionNames: extPtrs.baseAddress
                        )
                        let rc = vkCreateInstance(&info, nil, &instance)
                        if rc != VK_SUCCESS {
                            throw MpvVulkanBridgeError.vk(rc, "vkCreateInstance")
                        }
                    }
                }
            }
        }
        guard let inst = instance else { throw MpvVulkanBridgeError.vk(VK_ERROR_INITIALIZATION_FAILED, "vkCreateInstance returned null") }
        self.instance = inst

        // ── 2. Physical device ─────────────────────────────────────────
        var pdCount: UInt32 = 0
        let pdEnumRc1 = vkEnumeratePhysicalDevices(inst, &pdCount, nil)
        if pdEnumRc1 != VK_SUCCESS {
            vkDestroyInstance(inst, nil)
            throw MpvVulkanBridgeError.vk(pdEnumRc1, "vkEnumeratePhysicalDevices(count)")
        }
        guard pdCount > 0 else {
            vkDestroyInstance(inst, nil)
            throw MpvVulkanBridgeError.noPhysicalDevice
        }
        var pds = [VkPhysicalDevice?](repeating: nil, count: Int(pdCount))
        let pdEnumRc2 = pds.withUnsafeMutableBufferPointer { buf in
            vkEnumeratePhysicalDevices(inst, &pdCount, buf.baseAddress)
        }
        if pdEnumRc2 != VK_SUCCESS {
            vkDestroyInstance(inst, nil)
            throw MpvVulkanBridgeError.vk(pdEnumRc2, "vkEnumeratePhysicalDevices(fetch)")
        }
        guard let pd = pds[0] else {
            vkDestroyInstance(inst, nil)
            throw MpvVulkanBridgeError.noPhysicalDevice
        }
        self.physicalDevice = pd

        // ── 3. Queue family — first graphics-capable ──────────────────
        var qfCount: UInt32 = 0
        vkGetPhysicalDeviceQueueFamilyProperties(pd, &qfCount, nil)
        var qfp = [VkQueueFamilyProperties](
            repeating: VkQueueFamilyProperties(
                queueFlags: 0, queueCount: 0, timestampValidBits: 0,
                minImageTransferGranularity: VkExtent3D(width: 0, height: 0, depth: 0)
            ),
            count: Int(qfCount)
        )
        qfp.withUnsafeMutableBufferPointer { buf in
            vkGetPhysicalDeviceQueueFamilyProperties(pd, &qfCount, buf.baseAddress)
        }
        var foundIdx: UInt32 = UInt32.max
        for i in 0..<Int(qfCount) {
            if (qfp[i].queueFlags & VkQueueFlags(VK_QUEUE_GRAPHICS_BIT.rawValue)) != 0 {
                foundIdx = UInt32(i)
                break
            }
        }
        guard foundIdx != UInt32.max else {
            vkDestroyInstance(inst, nil)
            throw MpvVulkanBridgeError.noGraphicsQueue
        }
        self.queueFamilyIndex = foundIdx
        self.queueIndex = 0

        // ── 4. Logical device ─────────────────────────────────────────
        let deviceExts: [String] = [
            "VK_KHR_portability_subset",
            "VK_KHR_external_memory",
            "VK_EXT_metal_objects",
            "VK_EXT_external_memory_metal",
        ]

        // libplacebo's `pl_vulkan_required_features` mandates these two
        // Vulkan 1.2 features. Enable them via VkPhysicalDeviceVulkan12Features
        // chained into VkDeviceCreateInfo's pNext — without them
        // pl_vulkan_import errors with "Missing device feature: hostQueryReset"
        // and mpv_render_context_create returns -18 (UNSUPPORTED).
        // (Source: libplacebo/src/vulkan/context.c required_vk12.)
        var vk12Features = VkPhysicalDeviceVulkan12Features(
            sType: VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_VULKAN_1_2_FEATURES,
            pNext: nil,
            samplerMirrorClampToEdge: 0,
            drawIndirectCount: 0,
            storageBuffer8BitAccess: 0,
            uniformAndStorageBuffer8BitAccess: 0,
            storagePushConstant8: 0,
            shaderBufferInt64Atomics: 0,
            shaderSharedInt64Atomics: 0,
            shaderFloat16: 0,
            shaderInt8: 0,
            descriptorIndexing: 0,
            shaderInputAttachmentArrayDynamicIndexing: 0,
            shaderUniformTexelBufferArrayDynamicIndexing: 0,
            shaderStorageTexelBufferArrayDynamicIndexing: 0,
            shaderUniformBufferArrayNonUniformIndexing: 0,
            shaderSampledImageArrayNonUniformIndexing: 0,
            shaderStorageBufferArrayNonUniformIndexing: 0,
            shaderStorageImageArrayNonUniformIndexing: 0,
            shaderInputAttachmentArrayNonUniformIndexing: 0,
            shaderUniformTexelBufferArrayNonUniformIndexing: 0,
            shaderStorageTexelBufferArrayNonUniformIndexing: 0,
            descriptorBindingUniformBufferUpdateAfterBind: 0,
            descriptorBindingSampledImageUpdateAfterBind: 0,
            descriptorBindingStorageImageUpdateAfterBind: 0,
            descriptorBindingStorageBufferUpdateAfterBind: 0,
            descriptorBindingUniformTexelBufferUpdateAfterBind: 0,
            descriptorBindingStorageTexelBufferUpdateAfterBind: 0,
            descriptorBindingUpdateUnusedWhilePending: 0,
            descriptorBindingPartiallyBound: 0,
            descriptorBindingVariableDescriptorCount: 0,
            runtimeDescriptorArray: 0,
            samplerFilterMinmax: 0,
            scalarBlockLayout: 0,
            imagelessFramebuffer: 0,
            uniformBufferStandardLayout: 0,
            shaderSubgroupExtendedTypes: 0,
            separateDepthStencilLayouts: 0,
            hostQueryReset: 1,
            timelineSemaphore: 1,
            bufferDeviceAddress: 0,
            bufferDeviceAddressCaptureReplay: 0,
            bufferDeviceAddressMultiDevice: 0,
            vulkanMemoryModel: 0,
            vulkanMemoryModelDeviceScope: 0,
            vulkanMemoryModelAvailabilityVisibilityChains: 0,
            shaderOutputViewportIndex: 0,
            shaderOutputLayer: 0,
            subgroupBroadcastDynamicId: 0
        )

        // Same lifetime concern as the instance: `pQueuePriorities`,
        // `pQueueCreateInfos`, and the vk12-features pNext chain are all
        // pointers Vulkan reads inside vkCreateDevice; they must outlive
        // the call. Nested withUnsafePointer scopes keep the storage live
        // until vkCreateDevice returns.
        let queuePriority: Float = 1.0
        var device: VkDevice? = nil
        try withUnsafeMutablePointer(to: &vk12Features) { vk12Ptr in
            try withUnsafePointer(to: queuePriority) { priorityPtr in
                let queueInfo = VkDeviceQueueCreateInfo(
                    sType: VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO,
                    pNext: nil,
                    flags: 0,
                    queueFamilyIndex: foundIdx,
                    queueCount: 1,
                    pQueuePriorities: priorityPtr
                )
                try withUnsafePointer(to: queueInfo) { queueInfoPtr in
                    try withCStrings(deviceExts) { extPtrs in
                        var info = VkDeviceCreateInfo(
                            sType: VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO,
                            pNext: UnsafeRawPointer(vk12Ptr),
                            flags: 0,
                            queueCreateInfoCount: 1,
                            pQueueCreateInfos: queueInfoPtr,
                            enabledLayerCount: 0,
                            ppEnabledLayerNames: nil,
                            enabledExtensionCount: UInt32(extPtrs.count),
                            ppEnabledExtensionNames: extPtrs.baseAddress,
                            pEnabledFeatures: nil
                        )
                        let rc = vkCreateDevice(pd, &info, nil, &device)
                        if rc != VK_SUCCESS {
                            throw MpvVulkanBridgeError.vk(rc, "vkCreateDevice")
                        }
                    }
                }
            }
        }
        guard let dev = device else {
            vkDestroyInstance(inst, nil)
            throw MpvVulkanBridgeError.vk(VK_ERROR_INITIALIZATION_FAILED, "vkCreateDevice returned null")
        }
        self.device = dev

        var queue: VkQueue? = nil
        vkGetDeviceQueue(dev, foundIdx, 0, &queue)
        guard let q = queue else {
            vkDestroyDevice(dev, nil)
            vkDestroyInstance(inst, nil)
            throw MpvVulkanBridgeError.noGraphicsQueue
        }
        self.queue = q

        _ = debug // reserved for validation-layer hookup later
    }

    deinit {
        vkDeviceWaitIdle(device)
        vkDestroyDevice(device, nil)
        vkDestroyInstance(instance, nil)
    }

    // MARK: - IOSurface → VkImage

    /// Create a VkImage backed by the supplied IOSurface. The image is
    /// created with the same usage flags libmpv's libmpv_vk path
    /// expects (`pl_vulkan_wrap` calls in
    /// `~/projects/mpv-apple/video/out/vulkan/libmpv_vk.c`):
    ///     COLOR_ATTACHMENT | TRANSFER_DST | TRANSFER_SRC | SAMPLED.
    ///
    /// We thread three independent MoltenVK 1.4.1 gates to land an
    /// IOSurface-backed render target on Apple Silicon — get any of them
    /// wrong and we get a flat-green frame or an outright Metal abort:
    ///
    /// 1. **Bind a `VkDeviceMemory` of type `DEVICE_LOCAL` (Private).**
    ///    `MVKImage::getMTLStorageMode()` (`MVKImage.mm:1115`) returns
    ///    `Private` outright when no memory is bound, so the
    ///    IOSurface→Shared promotion at line 1119 is bypassed; iOS 17+
    ///    Metal validation rejects the resulting MTLTexture
    ///    ("IOSurface textures must use MTLStorageModeShared"). Binding
    ///    Private memory means line 1117 reads `Private` from the
    ///    memory and line 1119 promotes it to `Shared` via the
    ///    `_ioSurface` fallback — exactly what iOS expects.
    /// 2. **Use `VK_IMAGE_TILING_OPTIMAL`.** The texel-buffer gate at
    ///    `MVKImageMemoryBinding::bindDeviceMemory` (`MVKImage.mm:481`)
    ///    fires on `(host-visible || placementHeaps) && _isLinear` and
    ///    silently swaps the IOSurface for an MTLBuffer; OPTIMAL keeps
    ///    `_isLinear = false` and the IOSurface remains the backing.
    /// 3. **Don't pick HOST_VISIBLE memory.** With host-accessible
    ///    memory bound, `MVKImageMemoryBinding::bindDeviceMemory`
    ///    (`MVKImage.mm:508`) calls `flushToDevice`, which issues a
    ///    `[mtlTex replaceRegion:]` whose computed `bytesPerRow` does
    ///    NOT match the IOSurface's row stride — Metal asserts:
    ///    `bytesPerRow(7858) must be a multiple of MTLPixelFormatBGRA8Unorm
    ///    pixel bytes(4)`. Private memory has `isMemoryHostAccessible() =
    ///    false`, so `shouldFlushHostMemory()` returns false and the
    ///    flush is a no-op.
    ///
    /// Caller owns the returned pair and must call `destroyImage(_:)`
    /// before the bridge is deinitialised.
    func makeImageFromIOSurface(
        _ ioSurface: IOSurfaceRef,
        width: UInt32,
        height: UInt32,
        format: VkFormat
    ) throws -> MpvIOSurfaceVkImage {
        // The synthesized vulkan_metal.h forward-declares
        // `typedef struct __IOSurface* IOSurfaceRef;` without CF bridging
        // annotations, so Swift exposes the field as `Unmanaged<IOSurfaceRef>`.
        // Pass unretained — the VkImage retains the surface for its lifetime
        // and we hold the strong reference in the RingEntry.
        var importInfo = VkImportMetalIOSurfaceInfoEXT(
            sType: VK_STRUCTURE_TYPE_IMPORT_METAL_IO_SURFACE_INFO_EXT,
            pNext: nil,
            ioSurface: Unmanaged.passUnretained(ioSurface)
        )

        // Always OPTIMAL — on both simulator and real device.
        //
        // LINEAR is a trap on Apple Silicon: MoltenVK's
        // `MVKImageMemoryBinding::bindDeviceMemory`
        // (`MVKImage.mm` line 481) gates a "texel buffer" code path on
        //     (isMemoryHostAccessible() || placementHeaps) && _isLinear
        // When all conditions hold (HOST_VISIBLE bind + LINEAR + Apple
        // GPU with placement-heap support), MoltenVK creates an MTLBuffer
        // as the texture's storage and silently *bypasses* the IOSurface
        // backing entirely. libplacebo's writes land in that throwaway
        // buffer; AVSBDL reads the IOSurface and gets uninitialized
        // bytes (manifests as a flat ~(0,77,0) green clear).
        //
        // OPTIMAL avoids that path (`!_isLinear` → no texel buffer);
        // the MTLTexture is created from the IOSurface itself, which
        // on iOS is what we need. Apple's Metal handles tile↔linear
        // translation internally for IOSurface-backed render targets,
        // so the IOSurface ends up with plain BGRA bytes after rendering
        // even though Vulkan thinks the layout is OPTIMAL.
        //
        // The simulator's MoltenVK rejects LINEAR + COLOR_ATTACHMENT
        // for B8G8R8A8_UNORM anyway (VK_ERROR_FEATURE_NOT_PRESENT), so
        // OPTIMAL was already required there.
        let imageTiling = VK_IMAGE_TILING_OPTIMAL

        var image: VkImage? = nil
        try withUnsafePointer(to: &importInfo) { importPtr in
            var info = VkImageCreateInfo(
                sType: VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                pNext: UnsafeRawPointer(importPtr),
                flags: 0,
                imageType: VK_IMAGE_TYPE_2D,
                format: format,
                extent: VkExtent3D(width: width, height: height, depth: 1),
                mipLevels: 1,
                arrayLayers: 1,
                samples: VK_SAMPLE_COUNT_1_BIT,
                tiling: imageTiling,
                usage: VkImageUsageFlags(
                    VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT.rawValue
                    | VK_IMAGE_USAGE_TRANSFER_DST_BIT.rawValue
                    | VK_IMAGE_USAGE_TRANSFER_SRC_BIT.rawValue
                    | VK_IMAGE_USAGE_SAMPLED_BIT.rawValue
                ),
                sharingMode: VK_SHARING_MODE_EXCLUSIVE,
                queueFamilyIndexCount: 0,
                pQueueFamilyIndices: nil,
                initialLayout: VK_IMAGE_LAYOUT_UNDEFINED
            )
            let rc = vkCreateImage(device, &info, nil, &image)
            if rc != VK_SUCCESS {
                throw MpvVulkanBridgeError.vk(rc, "vkCreateImage(IOSurface)")
            }
        }
        guard let img = image else {
            throw MpvVulkanBridgeError.vk(VK_ERROR_INITIALIZATION_FAILED, "vkCreateImage(IOSurface) returned null")
        }

        // Allocate + bind DEVICE_LOCAL (Private) memory. See the doc
        // comment above for why HOST_VISIBLE is wrong here. On any
        // failure we must destroy the freshly-created image before
        // propagating — otherwise we leak a VkImage on every error path.
        let memory: VkDeviceMemory
        do {
            memory = try allocateDeviceLocalMemory(forImage: img)
        } catch {
            vkDestroyImage(device, img, nil)
            throw error
        }
        let bindRc = vkBindImageMemory(device, img, memory, 0)
        if bindRc != VK_SUCCESS {
            vkFreeMemory(device, memory, nil)
            vkDestroyImage(device, img, nil)
            throw MpvVulkanBridgeError.vk(bindRc, "vkBindImageMemory(IOSurface)")
        }
        return MpvIOSurfaceVkImage(image: img, memory: memory)
    }

    func destroyImage(_ owned: MpvIOSurfaceVkImage) {
        vkDestroyImage(device, owned.image, nil)
        vkFreeMemory(device, owned.memory, nil)
    }

    /// Allocate a VkDeviceMemory matching the image's memory requirements,
    /// preferring `DEVICE_LOCAL` (maps to `MTLStorageModePrivate` in
    /// MoltenVK, which is then promoted to `Shared` for IOSurface-backed
    /// images via the `_ioSurface` fallback in
    /// `MVKImage::getMTLStorageMode()` line 1119). HOST_VISIBLE memory
    /// would trip MoltenVK's `flushToDevice` call inside
    /// `vkBindImageMemory`, which issues a `replaceRegion` with a
    /// bytesPerRow that doesn't match the IOSurface's row stride.
    private func allocateDeviceLocalMemory(forImage image: VkImage) throws -> VkDeviceMemory {
        var reqs = VkMemoryRequirements(size: 0, alignment: 0, memoryTypeBits: 0)
        vkGetImageMemoryRequirements(device, image, &reqs)

        // VkPhysicalDeviceMemoryProperties contains fixed-size C-array
        // tuples (32 memoryTypes, 16 memoryHeaps) that Swift can't
        // default-construct, so we hand Vulkan an uninitialized
        // heap-allocated out-buffer, then copy onto the stack so the
        // tuple is addressable.
        let memPropsPtr = UnsafeMutablePointer<VkPhysicalDeviceMemoryProperties>.allocate(capacity: 1)
        defer { memPropsPtr.deallocate() }
        vkGetPhysicalDeviceMemoryProperties(physicalDevice, memPropsPtr)
        var memProps = memPropsPtr.pointee

        let preferred: VkMemoryPropertyFlags = VkMemoryPropertyFlags(
            VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT.rawValue
        )
        let hostVisible: VkMemoryPropertyFlags = VkMemoryPropertyFlags(
            VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT.rawValue
        )

        let typeCount = Int(memProps.memoryTypeCount)
        let memTypeBits = reqs.memoryTypeBits

        // `memoryTypes` is a homogeneous tuple. Take a pointer to the
        // tuple value and rebind it as a VkMemoryType buffer for integer
        // indexing.
        func findIndex(matching mask: VkMemoryPropertyFlags, excluding excl: VkMemoryPropertyFlags = 0) -> UInt32? {
            return withUnsafePointer(to: &memProps.memoryTypes) { tuplePtr in
                let buf = UnsafeRawPointer(tuplePtr).assumingMemoryBound(to: VkMemoryType.self)
                for i in 0..<typeCount {
                    if (memTypeBits & (UInt32(1) << UInt32(i))) == 0 { continue }
                    let flags = buf[i].propertyFlags
                    if (flags & mask) != mask { continue }
                    if excl != 0 && (flags & excl) != 0 { continue }
                    return UInt32(i)
                }
                return nil
            }
        }

        // Prefer DEVICE_LOCAL & not HOST_VISIBLE (true Private). On a
        // unified-memory GPU like Apple Silicon, every memory type
        // typically advertises DEVICE_LOCAL, but a subset is also
        // HOST_VISIBLE — we want the strictly-Private one.
        guard let typeIndex = findIndex(matching: preferred, excluding: hostVisible)
            ?? findIndex(matching: preferred)
        else {
            throw MpvVulkanBridgeError.noSuitableMemoryType
        }

        var alloc = VkMemoryAllocateInfo(
            sType: VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO,
            pNext: nil,
            allocationSize: reqs.size,
            memoryTypeIndex: typeIndex
        )
        var memory: VkDeviceMemory? = nil
        let rc = vkAllocateMemory(device, &alloc, nil, &memory)
        if rc != VK_SUCCESS {
            throw MpvVulkanBridgeError.vk(rc, "vkAllocateMemory(IOSurface)")
        }
        guard let mem = memory else {
            throw MpvVulkanBridgeError.vk(VK_ERROR_INITIALIZATION_FAILED,
                                          "vkAllocateMemory(IOSurface) returned null")
        }
        return mem
    }

    /// Device extensions we enabled at `vkCreateDevice` — passed through
    /// to mpv via `mpv_libmpv_apple_pool_params.device_extensions` so
    /// libplacebo's `pl_vulkan_import` loads matching function pointers.
    static let enabledDeviceExtensions: [String] = [
        "VK_KHR_portability_subset",
        "VK_KHR_external_memory",
        "VK_EXT_metal_objects",
        "VK_EXT_external_memory_metal",
    ]

    /// `vkGetInstanceProcAddr` as a raw C function pointer in the shape
    /// libplacebo / mpv expect. Re-exported because `pl_vulkan_import`
    /// resolves all other entry points through this single function pointer.
    static let getInstanceProcAddrFnPointer: PFN_vkGetInstanceProcAddr = vkGetInstanceProcAddr
}

// MARK: - Helpers

/// Convert `[String]` to `[UnsafePointer<CChar>?]` for the duration of
/// the closure. The C strings are heap-allocated by `strdup` and freed
/// when the closure returns.
private func withCStrings<T>(
    _ strings: [String],
    body: (UnsafeBufferPointer<UnsafePointer<CChar>?>) throws -> T
) rethrows -> T {
    let cStrings: [UnsafeMutablePointer<CChar>?] = strings.map { strdup($0) }
    defer { cStrings.forEach { free($0) } }
    let pointers: [UnsafePointer<CChar>?] = cStrings.map { UnsafePointer($0) }
    return try pointers.withUnsafeBufferPointer { try body($0) }
}
