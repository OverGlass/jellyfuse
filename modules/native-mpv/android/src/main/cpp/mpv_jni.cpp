//
// mpv_jni.cpp — Android JNI bridge to libmpv.
//
// Thin bindings: every method on MpvBridge.kt maps to one function
// here. Matches the shape of the Swift code in ios/HybridNativeMpv.swift
// + ios/HybridMpvVideoView.swift, just expressed through JNI instead
// of Swift's C-interop.
//
// Compile gate: when JELLYFUSE_MPV_LINKED is defined (libmpv vendored
// at build time), the functions call into libmpv. When it is not
// (stubs-only build without a libmpv tarball — see
// scripts/fetch-libmpv-android.sh), every function returns a sentinel
// (0 / empty / false) so the JNI symbols still exist and the Kotlin
// layer can fall back to throwing mpv.not_implemented via
// MpvBridge.isLinked().
//

#include <jni.h>
#include <android/log.h>
#include <cstring>

#ifdef JELLYFUSE_MPV_LINKED
#include <android/native_window_jni.h>
#include <EGL/egl.h>
#include <GLES3/gl3.h>
#include <dlfcn.h>
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_gl.h>
#endif

#define LOG_TAG "NativeMpv/jni"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {

#ifdef JELLYFUSE_MPV_LINKED

// mpv's Android gpu-context + mediacodec hwdec both require ffmpeg to
// hold a JNIEnv* so they can talk to the platform's MediaCodec and
// Surface classes. Without this, mpv logs "No Java virtual machine has
// been registered" and vo=gpu-next/gpu bails with "Failed initializing
// any suitable GPU context!" — matches mpv-android's
// app/src/main/jni/main.cpp JNI_OnLoad.
typedef int (*av_jni_set_java_vm_fn)(void* vm, void* log_ctx);

static void registerJavaVmWithFfmpeg(JavaVM* vm) {
    void* sym = dlsym(RTLD_DEFAULT, "av_jni_set_java_vm");
    if (sym == nullptr) {
        LOGE("av_jni_set_java_vm not found — mediacodec/gpu-context will fail");
        return;
    }
    auto fn = reinterpret_cast<av_jni_set_java_vm_fn>(sym);
    int rc = fn(vm, nullptr);
    if (rc != 0) LOGE("av_jni_set_java_vm failed: %d", rc);
    else LOGI("ffmpeg JNI VM registered");
}

// ── Render surface holder ─────────────────────────────────────────────────
// One per mpv_handle. Owns the EGLDisplay/Context/Surface triple, the
// ANativeWindow pulled from the Java Surface, and the mpv_render_context.
//
// We pass this opaque pointer back to Kotlin as a jlong so the Kotlin
// side can drive render-frame without caring about the underlying GL
// objects.
struct MpvRenderSurface {
    mpv_handle* mpv = nullptr;
    mpv_render_context* renderCtx = nullptr;
    ANativeWindow* window = nullptr;
    EGLDisplay display = EGL_NO_DISPLAY;
    EGLContext context = EGL_NO_CONTEXT;
    EGLSurface surface = EGL_NO_SURFACE;
    EGLConfig config = nullptr;
    int width = 0;
    int height = 0;
};

static void* getProcAddress(void* /*ctx*/, const char* name) {
    // mpv's gl loader — dlsym against RTLD_DEFAULT so we pick up
    // whatever GLES library libmpv is linked against.
    return (void*) eglGetProcAddress(name);
}

static bool initEgl(MpvRenderSurface* rs) {
    rs->display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
    if (rs->display == EGL_NO_DISPLAY) {
        LOGE("eglGetDisplay failed");
        return false;
    }
    if (!eglInitialize(rs->display, nullptr, nullptr)) {
        LOGE("eglInitialize failed");
        return false;
    }

    const EGLint configAttribs[] = {
        EGL_SURFACE_TYPE, EGL_WINDOW_BIT,
        EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
        EGL_RED_SIZE, 8,
        EGL_GREEN_SIZE, 8,
        EGL_BLUE_SIZE, 8,
        EGL_ALPHA_SIZE, 0,
        EGL_DEPTH_SIZE, 0,
        EGL_STENCIL_SIZE, 0,
        EGL_NONE
    };
    EGLint numConfigs = 0;
    if (!eglChooseConfig(rs->display, configAttribs, &rs->config, 1, &numConfigs) || numConfigs < 1) {
        LOGE("eglChooseConfig failed");
        return false;
    }

    const EGLint ctxAttribs[] = { EGL_CONTEXT_CLIENT_VERSION, 3, EGL_NONE };
    rs->context = eglCreateContext(rs->display, rs->config, EGL_NO_CONTEXT, ctxAttribs);
    if (rs->context == EGL_NO_CONTEXT) {
        LOGE("eglCreateContext failed");
        return false;
    }

    rs->surface = eglCreateWindowSurface(rs->display, rs->config, rs->window, nullptr);
    if (rs->surface == EGL_NO_SURFACE) {
        LOGE("eglCreateWindowSurface failed");
        return false;
    }

    if (!eglMakeCurrent(rs->display, rs->surface, rs->surface, rs->context)) {
        LOGE("eglMakeCurrent failed");
        return false;
    }

    eglQuerySurface(rs->display, rs->surface, EGL_WIDTH, &rs->width);
    eglQuerySurface(rs->display, rs->surface, EGL_HEIGHT, &rs->height);
    return true;
}

static void tearDownEgl(MpvRenderSurface* rs) {
    if (rs->display != EGL_NO_DISPLAY) {
        eglMakeCurrent(rs->display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
        if (rs->surface != EGL_NO_SURFACE) {
            eglDestroySurface(rs->display, rs->surface);
            rs->surface = EGL_NO_SURFACE;
        }
        if (rs->context != EGL_NO_CONTEXT) {
            eglDestroyContext(rs->display, rs->context);
            rs->context = EGL_NO_CONTEXT;
        }
        eglTerminate(rs->display);
        rs->display = EGL_NO_DISPLAY;
    }
    if (rs->window != nullptr) {
        ANativeWindow_release(rs->window);
        rs->window = nullptr;
    }
}

// Weak reference back to the Kotlin MpvBridge companion so we can
// signal `onWakeup` from mpv's wakeup callback thread. The Kotlin
// side posts this onto the event HandlerThread so mpv_wait_event
// returns promptly after a shutdown/seek/etc.
struct JavaCallbacks {
    JavaVM* vm = nullptr;
    jclass bridgeCls = nullptr;  // global ref
    jmethodID onWakeupId = nullptr;
};
static JavaCallbacks gCallbacks;

static void onMpvWakeup(void* ctx) {
    auto handle = reinterpret_cast<jlong>(ctx);
    if (gCallbacks.vm == nullptr || gCallbacks.onWakeupId == nullptr) return;
    JNIEnv* env = nullptr;
    bool attached = false;
    if (gCallbacks.vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        if (gCallbacks.vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
        attached = true;
    }
    env->CallStaticVoidMethod(gCallbacks.bridgeCls, gCallbacks.onWakeupId, handle);
    if (attached) gCallbacks.vm->DetachCurrentThread();
}

#endif // JELLYFUSE_MPV_LINKED

} // namespace

extern "C" {

JNIEXPORT jboolean JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeIsLinked(JNIEnv*, jobject) {
#ifdef JELLYFUSE_MPV_LINKED
    return JNI_TRUE;
#else
    return JNI_FALSE;
#endif
}

JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeCreate(JNIEnv* env, jobject) {
#ifdef JELLYFUSE_MPV_LINKED
    if (gCallbacks.vm == nullptr) {
        env->GetJavaVM(&gCallbacks.vm);
        jclass local = env->FindClass("com/margelo/nitro/nativempv/MpvBridge");
        if (local != nullptr) {
            gCallbacks.bridgeCls = reinterpret_cast<jclass>(env->NewGlobalRef(local));
            gCallbacks.onWakeupId = env->GetStaticMethodID(gCallbacks.bridgeCls, "onWakeupFromNative", "(J)V");
            env->DeleteLocalRef(local);
        }
    }
    mpv_handle* mpv = mpv_create();
    if (mpv == nullptr) return 0;
    return reinterpret_cast<jlong>(mpv);
#else
    (void) env;
    return 0;
#endif
}

JNIEXPORT jint JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeInitialize(JNIEnv*, jobject, jlong handle) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return -1;
    int rc = mpv_initialize(mpv);
    if (rc >= 0) {
        mpv_set_wakeup_callback(mpv, onMpvWakeup, reinterpret_cast<void*>(handle));
    }
    return rc;
#else
    (void) handle;
    return -1;
#endif
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeTerminate(JNIEnv*, jobject, jlong handle) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return;
    mpv_set_wakeup_callback(mpv, nullptr, nullptr);
    mpv_terminate_destroy(mpv);
#else
    (void) handle;
#endif
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeWakeup(JNIEnv*, jobject, jlong handle) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv != nullptr) mpv_wakeup(mpv);
#else
    (void) handle;
#endif
}

JNIEXPORT jint JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeCommand(JNIEnv* env, jobject, jlong handle, jobjectArray args) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return -1;
    jsize len = env->GetArrayLength(args);
    // Build a null-terminated const char* array. We dup each string
    // into a local buffer that we free after the command returns.
    const char** cargs = new const char*[len + 1];
    jstring* jstrs = new jstring[len];
    for (jsize i = 0; i < len; i++) {
        jstrs[i] = reinterpret_cast<jstring>(env->GetObjectArrayElement(args, i));
        cargs[i] = jstrs[i] == nullptr ? nullptr : env->GetStringUTFChars(jstrs[i], nullptr);
    }
    cargs[len] = nullptr;
    int rc = mpv_command(mpv, const_cast<const char**>(cargs));
    for (jsize i = 0; i < len; i++) {
        if (jstrs[i] != nullptr) {
            env->ReleaseStringUTFChars(jstrs[i], cargs[i]);
            env->DeleteLocalRef(jstrs[i]);
        }
    }
    delete[] cargs;
    delete[] jstrs;
    return rc;
#else
    (void) env; (void) handle; (void) args;
    return -1;
#endif
}

JNIEXPORT jint JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeSetOptionString(JNIEnv* env, jobject, jlong handle, jstring name, jstring value) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return -1;
    const char* n = env->GetStringUTFChars(name, nullptr);
    const char* v = env->GetStringUTFChars(value, nullptr);
    int rc = mpv_set_option_string(mpv, n, v);
    env->ReleaseStringUTFChars(name, n);
    env->ReleaseStringUTFChars(value, v);
    return rc;
#else
    (void) env; (void) handle; (void) name; (void) value;
    return -1;
#endif
}

JNIEXPORT jint JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeSetPropertyString(JNIEnv* env, jobject, jlong handle, jstring name, jstring value) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return -1;
    const char* n = env->GetStringUTFChars(name, nullptr);
    const char* v = env->GetStringUTFChars(value, nullptr);
    int rc = mpv_set_property_string(mpv, n, v);
    env->ReleaseStringUTFChars(name, n);
    env->ReleaseStringUTFChars(value, v);
    return rc;
#else
    (void) env; (void) handle; (void) name; (void) value;
    return -1;
#endif
}

JNIEXPORT jstring JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeGetPropertyString(JNIEnv* env, jobject, jlong handle, jstring name) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return nullptr;
    const char* n = env->GetStringUTFChars(name, nullptr);
    char* raw = mpv_get_property_string(mpv, n);
    env->ReleaseStringUTFChars(name, n);
    if (raw == nullptr) return nullptr;
    jstring result = env->NewStringUTF(raw);
    mpv_free(raw);
    return result;
#else
    (void) env; (void) handle; (void) name;
    return nullptr;
#endif
}

JNIEXPORT jint JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeObserveProperty(JNIEnv* env, jobject, jlong handle, jlong userdata, jstring name, jint format) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return -1;
    const char* n = env->GetStringUTFChars(name, nullptr);
    int rc = mpv_observe_property(mpv, static_cast<uint64_t>(userdata), n, static_cast<mpv_format>(format));
    env->ReleaseStringUTFChars(name, n);
    return rc;
#else
    (void) env; (void) handle; (void) userdata; (void) name; (void) format;
    return -1;
#endif
}

JNIEXPORT jint JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeRequestLogMessages(JNIEnv* env, jobject, jlong handle, jstring level) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return -1;
    const char* l = env->GetStringUTFChars(level, nullptr);
    int rc = mpv_request_log_messages(mpv, l);
    env->ReleaseStringUTFChars(level, l);
    return rc;
#else
    (void) env; (void) handle; (void) level;
    return -1;
#endif
}

JNIEXPORT jstring JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeErrorString(JNIEnv* env, jobject, jint code) {
#ifdef JELLYFUSE_MPV_LINKED
    return env->NewStringUTF(mpv_error_string(code));
#else
    (void) code;
    return env->NewStringUTF("mpv not linked");
#endif
}

// ── Event loop ────────────────────────────────────────────────────────────
// mpv_wait_event returns a pointer owned by mpv (valid until the next
// wait_event on the same handle). We unpack it into a Kotlin
// MpvEvent data class and return that — mirrors the way the Swift
// code reads fields straight off mpv_event in-place.
//
// The Kotlin-side MpvEvent is defined in MpvBridge.kt.

#ifdef JELLYFUSE_MPV_LINKED
static jclass gMpvEventCls = nullptr;
static jmethodID gMpvEventCtor = nullptr;

static void ensureMpvEventClass(JNIEnv* env) {
    if (gMpvEventCls != nullptr) return;
    jclass local = env->FindClass("com/margelo/nitro/nativempv/MpvEvent");
    if (local == nullptr) {
        LOGE("MpvEvent class not found");
        return;
    }
    gMpvEventCls = reinterpret_cast<jclass>(env->NewGlobalRef(local));
    // constructor: (I, I, Ljava/lang/String;, I, DZLjava/lang/String;)V
    gMpvEventCtor = env->GetMethodID(gMpvEventCls, "<init>", "(IILjava/lang/String;IDZLjava/lang/String;)V");
    env->DeleteLocalRef(local);
}
#endif

JNIEXPORT jobject JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeWaitEvent(JNIEnv* env, jobject, jlong handle, jdouble timeout) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr) return nullptr;
    ensureMpvEventClass(env);
    if (gMpvEventCls == nullptr) return nullptr;

    mpv_event* ev = mpv_wait_event(mpv, timeout);
    if (ev == nullptr || ev->event_id == MPV_EVENT_NONE) return nullptr;

    int eventId = static_cast<int>(ev->event_id);
    int errorCode = ev->error;
    jstring propName = nullptr;
    int propFormat = 0;
    double propDouble = 0.0;
    jboolean propFlag = JNI_FALSE;
    jstring propString = nullptr;

    if (ev->event_id == MPV_EVENT_PROPERTY_CHANGE && ev->data != nullptr) {
        auto* p = static_cast<mpv_event_property*>(ev->data);
        if (p->name != nullptr) propName = env->NewStringUTF(p->name);
        propFormat = static_cast<int>(p->format);
        if (p->data != nullptr) {
            switch (p->format) {
                case MPV_FORMAT_DOUBLE:
                    propDouble = *static_cast<double*>(p->data);
                    break;
                case MPV_FORMAT_FLAG:
                    propFlag = *static_cast<int*>(p->data) != 0 ? JNI_TRUE : JNI_FALSE;
                    break;
                case MPV_FORMAT_STRING: {
                    char* s = *static_cast<char**>(p->data);
                    if (s != nullptr) propString = env->NewStringUTF(s);
                    break;
                }
                default:
                    break;
            }
        }
    } else if (ev->event_id == MPV_EVENT_LOG_MESSAGE && ev->data != nullptr) {
        auto* m = static_cast<mpv_event_log_message*>(ev->data);
        if (m->text != nullptr) propString = env->NewStringUTF(m->text);
    }

    jobject eventObj = env->NewObject(
        gMpvEventCls, gMpvEventCtor,
        eventId, errorCode, propName, propFormat, propDouble, propFlag, propString
    );
    return eventObj;
#else
    (void) env; (void) handle; (void) timeout;
    return nullptr;
#endif
}

// ── Render context ────────────────────────────────────────────────────────
// We render directly to the SurfaceView via an EGL window bound to
// the Surface's ANativeWindow. mpv_render_context is used in OpenGL
// ES mode — mpv fills the framebuffer we hand it on each render call.

JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeRenderContextCreate(JNIEnv* env, jobject, jlong handle, jobject surface) {
#ifdef JELLYFUSE_MPV_LINKED
    auto mpv = reinterpret_cast<mpv_handle*>(handle);
    if (mpv == nullptr || surface == nullptr) return 0;

    auto* rs = new MpvRenderSurface{};
    rs->mpv = mpv;
    rs->window = ANativeWindow_fromSurface(env, surface);
    if (rs->window == nullptr) {
        LOGE("ANativeWindow_fromSurface returned null");
        delete rs;
        return 0;
    }
    if (!initEgl(rs)) {
        tearDownEgl(rs);
        delete rs;
        return 0;
    }

    mpv_opengl_init_params glInit = {};
    glInit.get_proc_address = getProcAddress;
    glInit.get_proc_address_ctx = nullptr;

    int one = 1;
    const char* apiType = MPV_RENDER_API_TYPE_OPENGL;
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(apiType) },
        { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit },
        { MPV_RENDER_PARAM_ADVANCED_CONTROL, &one },
        { MPV_RENDER_PARAM_INVALID, nullptr },
    };
    int rc = mpv_render_context_create(&rs->renderCtx, mpv, params);
    if (rc < 0) {
        LOGE("mpv_render_context_create failed: %d (%s)", rc, mpv_error_string(rc));
        tearDownEgl(rs);
        delete rs;
        return 0;
    }

    return reinterpret_cast<jlong>(rs);
#else
    (void) env; (void) handle; (void) surface;
    return 0;
#endif
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeRenderContextFree(JNIEnv*, jobject, jlong rsHandle) {
#ifdef JELLYFUSE_MPV_LINKED
    auto* rs = reinterpret_cast<MpvRenderSurface*>(rsHandle);
    if (rs == nullptr) return;
    if (rs->renderCtx != nullptr) {
        mpv_render_context_free(rs->renderCtx);
        rs->renderCtx = nullptr;
    }
    tearDownEgl(rs);
    delete rs;
#else
    (void) rsHandle;
#endif
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeRenderContextResize(JNIEnv*, jobject, jlong rsHandle, jint width, jint height) {
#ifdef JELLYFUSE_MPV_LINKED
    auto* rs = reinterpret_cast<MpvRenderSurface*>(rsHandle);
    if (rs == nullptr) return;
    rs->width = width;
    rs->height = height;
#else
    (void) rsHandle; (void) width; (void) height;
#endif
}

JNIEXPORT void JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeRenderFrame(JNIEnv*, jobject, jlong rsHandle) {
#ifdef JELLYFUSE_MPV_LINKED
    auto* rs = reinterpret_cast<MpvRenderSurface*>(rsHandle);
    if (rs == nullptr || rs->renderCtx == nullptr) return;

    eglMakeCurrent(rs->display, rs->surface, rs->surface, rs->context);

    int w = rs->width > 0 ? rs->width : 1;
    int h = rs->height > 0 ? rs->height : 1;

    mpv_opengl_fbo fbo = {};
    fbo.fbo = 0;              // default framebuffer (EGL window)
    fbo.w = w;
    fbo.h = h;
    fbo.internal_format = 0;

    int flipY = 1;
    mpv_render_param params[] = {
        { MPV_RENDER_PARAM_OPENGL_FBO, &fbo },
        { MPV_RENDER_PARAM_FLIP_Y, &flipY },
        { MPV_RENDER_PARAM_INVALID, nullptr },
    };
    mpv_render_context_render(rs->renderCtx, params);
    eglSwapBuffers(rs->display, rs->surface);
    mpv_render_context_report_swap(rs->renderCtx);
#else
    (void) rsHandle;
#endif
}

JNIEXPORT jlong JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeRenderContextUpdate(JNIEnv*, jobject, jlong rsHandle) {
#ifdef JELLYFUSE_MPV_LINKED
    auto* rs = reinterpret_cast<MpvRenderSurface*>(rsHandle);
    if (rs == nullptr || rs->renderCtx == nullptr) return 0;
    return static_cast<jlong>(mpv_render_context_update(rs->renderCtx));
#else
    (void) rsHandle;
    return 0;
#endif
}

#ifdef JELLYFUSE_MPV_LINKED
// Set from C++: called by the render-update callback so Kotlin can
// schedule a frame on the Choreographer.
static void onRenderUpdateCallback(void* ctx) {
    auto rsHandle = reinterpret_cast<jlong>(ctx);
    if (gCallbacks.vm == nullptr || gCallbacks.bridgeCls == nullptr) return;
    JNIEnv* env = nullptr;
    bool attached = false;
    if (gCallbacks.vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) {
        if (gCallbacks.vm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
        attached = true;
    }
    jmethodID m = env->GetStaticMethodID(gCallbacks.bridgeCls, "onRenderUpdateFromNative", "(J)V");
    if (m != nullptr) env->CallStaticVoidMethod(gCallbacks.bridgeCls, m, rsHandle);
    if (attached) gCallbacks.vm->DetachCurrentThread();
}
#endif

JNIEXPORT void JNICALL
Java_com_margelo_nitro_nativempv_MpvBridge_nativeRenderContextSetUpdateCallback(JNIEnv*, jobject, jlong rsHandle, jboolean enabled) {
#ifdef JELLYFUSE_MPV_LINKED
    auto* rs = reinterpret_cast<MpvRenderSurface*>(rsHandle);
    if (rs == nullptr || rs->renderCtx == nullptr) return;
    if (enabled) {
        mpv_render_context_set_update_callback(rs->renderCtx, onRenderUpdateCallback, reinterpret_cast<void*>(rsHandle));
    } else {
        mpv_render_context_set_update_callback(rs->renderCtx, nullptr, nullptr);
    }
#else
    (void) rsHandle; (void) enabled;
#endif
}

// Exposed for cpp-adapter.cpp's JNI_OnLoad to call after fbjni init.
JNIEXPORT void JNICALL jellyfuseRegisterFfmpegJvm(JavaVM* vm) {
#ifdef JELLYFUSE_MPV_LINKED
    registerJavaVmWithFfmpeg(vm);
#else
    (void) vm;
#endif
}

} // extern "C"
