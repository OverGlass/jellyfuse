#include <jni.h>
#include <fbjni/fbjni.h>
#include "NativeMpvOnLoad.hpp"

extern "C" void jellyfuseRegisterFfmpegJvm(JavaVM* vm);

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  jellyfuseRegisterFfmpegJvm(vm);
  return facebook::jni::initialize(vm, [=] {
    margelo::nitro::nativempv::registerAllNatives();
  });
}
