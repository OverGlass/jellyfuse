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

/// Owned triple returned from `makeImageFromIOSurface`. All three must
/// be released together via `destroyImage(_:)`. The MTLTexture is the
/// real backing — created in Swift with `allowGPUOptimizedContents =
/// false` so AGX doesn't compress the IOSurface bytes; handed to
/// MoltenVK verbatim via `VkImportMetalTextureInfoEXT`. The
/// VkDeviceMemory is a no-op placeholder Vulkan still requires.
struct MpvIOSurfaceVkImage {
    let image: VkImage
    let memory: VkDeviceMemory
    let mtlTexture: MTLTexture
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

    /// Create a VkImage backed by the supplied IOSurface, with
    /// COLOR_ATTACHMENT | TRANSFER_DST | TRANSFER_SRC | SAMPLED usage.
    ///
    /// We build the underlying `MTLTexture` ourselves in Swift and hand
    /// it to MoltenVK via `VkImportMetalTextureInfoEXT`, instead of
    /// letting MoltenVK build the texture from
    /// `VkImportMetalIOSurfaceInfoEXT` + a `VkImageCreateInfo`. The sole
    /// reason for this is to pin
    /// `MTLTextureDescriptor.allowGPUOptimizedContents = false`.
    ///
    /// MoltenVK 1.4.1 hardcodes `allowGPUOptimizedContents = YES` for
    /// every render-target texture (`MVKImage::newMTLTextureDescriptor`
    /// at `MVKImage.mm:159`). On Apple Silicon (A15 verified, likely
    /// every M1+ class GPU) Metal then engages AGX lossless compression
    /// for the BGRA8Unorm IOSurface-backed render target — the GPU
    /// writes a compressed payload through the IOSurface, AVSBDL reads
    /// the IOSurface as plain BGRA, and the entire frame collapses to a
    /// uniform clear-color (`(B=0, G=~77, R=0, A=255)` in our diagnostic
    /// dumps). The compression is invisible to a CPU-side
    /// `IOSurfaceLock` + read.
    ///
    /// `VkImportMetalTextureInfoEXT` short-circuits MoltenVK's
    /// descriptor builder (`MVKImage.mm:1285-1290` calls
    /// `setMTLTexture` at `vkCreateImage` time, and the cached
    /// `_mtlTexture` makes `MVKImagePlane::getMTLTexture` (`MVKImage.mm:41`)
    /// short-circuit on the first frame), so the
    /// `allowGPUOptimizedContents = YES` hardcode is bypassed entirely.
    ///
    /// We still allocate + bind a `VkDeviceMemory` from a `DEVICE_LOCAL`
    /// memory type — Vulkan requires every image to have memory bound
    /// before use, but with `_mtlTexture` already set MoltenVK never
    /// reads the bound memory; the binding is a no-op placeholder.
    ///
    /// Caller owns the returned triple and must call `destroyImage(_:)`
    /// before the bridge is deinitialised.
    func makeImageFromIOSurface(
        _ ioSurface: IOSurfaceRef,
        width: UInt32,
        height: UInt32,
        format _: VkFormat
    ) throws -> MpvIOSurfaceVkImage {
        // 1) Build the MTLTexture in Swift with the descriptor we
        //    actually want. We pin `allowGPUOptimizedContents = false`
        //    here — that's the whole reason this code path exists.
        let mtlTex = try makeIOSurfaceBackedMTLTexture(
            ioSurface: ioSurface, width: Int(width), height: Int(height)
        )

        // 2) vkCreateImage with `VkImportMetalTextureInfoEXT` chained
        //    into pNext. MoltenVK calls `setMTLTexture` from this
        //    (`MVKImage.mm:1285-1290`), captures + retains the texture,
        //    and pulls extent/format/usage/IOSurface from it directly
        //    — our `VkImageCreateInfo` fields must match what we built
        //    the MTLTexture with, but they aren't authoritative.
        //
        //    Swift's clang importer maps `MTLTexture_id` (the
        //    `__unsafe_unretained id<MTLTexture>` typedef from
        //    `vulkan_metal.h:78`) to `Unmanaged<any MTLTexture>`, so we
        //    hand it the unmanaged form. MoltenVK retains internally
        //    via `setMTLTexture` (`MVKImage.mm:1019`); we keep our own
        //    strong reference in the returned struct for symmetry on
        //    destroy.
        var importInfo = VkImportMetalTextureInfoEXT(
            sType: VK_STRUCTURE_TYPE_IMPORT_METAL_TEXTURE_INFO_EXT,
            pNext: nil,
            plane: VK_IMAGE_ASPECT_COLOR_BIT,
            mtlTexture: Unmanaged.passUnretained(mtlTex)
        )

        var image: VkImage? = nil
        try withUnsafePointer(to: &importInfo) { importPtr in
            var info = VkImageCreateInfo(
                sType: VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO,
                pNext: UnsafeRawPointer(importPtr),
                flags: 0,
                imageType: VK_IMAGE_TYPE_2D,
                format: VK_FORMAT_B8G8R8A8_UNORM,
                extent: VkExtent3D(width: width, height: height, depth: 1),
                mipLevels: 1,
                arrayLayers: 1,
                samples: VK_SAMPLE_COUNT_1_BIT,
                tiling: VK_IMAGE_TILING_OPTIMAL,
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
                throw MpvVulkanBridgeError.vk(rc, "vkCreateImage(MTLTexture import)")
            }
        }
        guard let img = image else {
            throw MpvVulkanBridgeError.vk(
                VK_ERROR_INITIALIZATION_FAILED, "vkCreateImage(MTLTexture import) returned null"
            )
        }

        // 3) Allocate + bind DEVICE_LOCAL (Private) memory to satisfy
        //    Vulkan's "must bind memory" requirement. With the texture
        //    already pre-set, MoltenVK never reads this memory — but
        //    `vkBindImageMemory` validation still checks it's there.
        //    On any failure here we must destroy the freshly-created
        //    image first to avoid leaking it.
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
            throw MpvVulkanBridgeError.vk(bindRc, "vkBindImageMemory(MTLTexture import)")
        }
        return MpvIOSurfaceVkImage(image: img, memory: memory, mtlTexture: mtlTex)
    }

    /// Build an MTLTexture from an IOSurface, mirroring the proven
    /// `hwdec_vt_pl.m` pattern (`storageMode = .shared`,
    /// `usage = [.shaderRead, .renderTarget]`) but extended for our
    /// render-target use case and pinning
    /// `allowGPUOptimizedContents = false` — without that, AGX lossless
    /// compression mangles the IOSurface bytes that AVSBDL reads.
    private func makeIOSurfaceBackedMTLTexture(
        ioSurface: IOSurfaceRef, width: Int, height: Int
    ) throws -> MTLTexture {
        let desc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm,
            width: width, height: height,
            mipmapped: false
        )
        // Render target + shader-read covers libplacebo's full usage
        // (color attachment + sampled). `.pixelFormatView` lets it
        // create swizzle / format views if needed.
        desc.usage = [.shaderRead, .renderTarget, .pixelFormatView]
        // Shared storage: GPU writes are visible to CPU/IOSurface
        // readers without a synchronizeResource: blit.
        desc.storageMode = .shared
        // Counts come from the texture, not the descriptor flags
        // above, but set them explicitly for clarity.
        desc.mipmapLevelCount = 1
        desc.arrayLength = 1
        desc.sampleCount = 1
        // The whole reason we're here. Default is YES, and on Apple
        // Silicon AGX engages lossless compression for BGRA8 RT
        // textures when YES — the IOSurface bytes come back
        // compressed and AVSBDL displays them as a uniform clear.
        desc.allowGPUOptimizedContents = false
        guard let tex = metalDevice.makeTexture(
            descriptor: desc, iosurface: ioSurface, plane: 0
        ) else {
            throw MpvVulkanBridgeError.vk(
                VK_ERROR_INITIALIZATION_FAILED,
                "MTLDevice.makeTexture(iosurface:) returned nil"
            )
        }
        return tex
    }

    func destroyImage(_ owned: MpvIOSurfaceVkImage) {
        vkDestroyImage(device, owned.image, nil)
        vkFreeMemory(device, owned.memory, nil)
        // `owned.mtlTexture`'s last Swift strong reference goes out
        // of scope here; ARC drops the +1 we held, MoltenVK's own
        // retain (taken at setMTLTexture / `MVKImage.mm:1019`) was
        // already released by `vkDestroyImage`.
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
