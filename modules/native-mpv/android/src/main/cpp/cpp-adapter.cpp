#include <jni.h>
#include <fbjni/fbjni.h>
#include "NativeMpvOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, [=] {
    margelo::nitro::nativempv::registerAllNatives();
  });
}
