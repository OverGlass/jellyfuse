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

    var description: String {
        switch self {
        case .vk(let rc, let where_):
            return "Vulkan error \(rc.rawValue) in \(where_)"
        case .noPhysicalDevice: return "No Vulkan physical device available"
        case .noGraphicsQueue: return "No graphics-capable queue family"
        }
    }
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
    /// Caller owns the returned VkImage and must call
    /// `destroyImage(_:)` before the bridge is deinitialised.
    func makeImageFromIOSurface(
        _ ioSurface: IOSurfaceRef,
        width: UInt32,
        height: UInt32,
        format: VkFormat
    ) throws -> VkImage {
        // VkImportMetalIOSurfaceInfoEXT chains into VkImageCreateInfo;
        // MoltenVK uses the IOSurface as the image's storage. No
        // separate vkAllocateMemory + vkBindImageMemory needed.
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
                throw MpvVulkanBridgeError.vk(rc, "vkCreateImage(IOSurface)")
            }
        }
        guard let img = image else {
            throw MpvVulkanBridgeError.vk(VK_ERROR_INITIALIZATION_FAILED, "vkCreateImage(IOSurface) returned null")
        }
        return img
    }

    func destroyImage(_ image: VkImage) {
        vkDestroyImage(device, image, nil)
    }

    // MARK: - mpv init params

    /// Build the `mpv_vulkan_init_params` we hand to
    /// `mpv_render_context_create`. The pointer to `get_proc_address`
    /// must point at MoltenVK's `vkGetInstanceProcAddr`; libplacebo
    /// resolves the rest of the entry points through it.
    func makeInitParams(debug: Bool = false) -> mpv_vulkan_init_params {
        return mpv_vulkan_init_params(
            get_proc_address: MpvVulkanBridge.getInstanceProcAddrFnPointer,
            vk_instance: instance,
            vk_physical_device: physicalDevice,
            vk_device: device,
            queue_family_index: queueFamilyIndex,
            queue_index: queueIndex,
            debug: debug ? 1 : 0
        )
    }

    /// `vkGetInstanceProcAddr` as a raw C function pointer in the
    /// shape `mpv_vulkan_init_params.get_proc_address` expects.
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
