project(NativeMpv)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NativeMpv)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# The JNI + Nitrogen bridge C++ sources. `mpv_jni.cpp` is Phase C.2 —
# Phase C.1 only wires the build so the module still links without it
# by falling back to the existing cpp-adapter.cpp when mpv_jni.cpp is
# absent.
set(MPV_JNI_SOURCE "${CMAKE_SOURCE_DIR}/src/main/cpp/mpv_jni.cpp")
if(EXISTS "${MPV_JNI_SOURCE}")
  add_library(${PACKAGE_NAME} SHARED
    src/main/cpp/cpp-adapter.cpp
    src/main/cpp/mpv_jni.cpp
  )
else()
  add_library(${PACKAGE_NAME} SHARED src/main/cpp/cpp-adapter.cpp)
endif()

# Nitrogen autolinking (unchanged from Phase A).
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NativeMpv+autolinking.cmake)

# ── vendored libmpv-android ───────────────────────────────────────────────
# The `fetchLibmpvAndroid` Gradle task runs before us and populates
# vendor/android/{include,<abi>/}. Until Phase C.2 lands the JNI layer
# (mpv_jni.cpp) we don't *strictly* need libmpv to build — so fall back
# to a stubs-only build when it's absent. That keeps the Phase A stubs
# runnable from CI + a fresh clone without running the build script.
set(MPV_VENDOR_DIR "${CMAKE_SOURCE_DIR}/../vendor/android")
set(MPV_LIB_PATH "${MPV_VENDOR_DIR}/${CMAKE_ANDROID_ARCH_ABI}/libmpv.so")
set(MPV_INCLUDE_DIR "${MPV_VENDOR_DIR}/include")

find_library(LOG_LIB log)
find_library(ANDROID_LIB android)

if(EXISTS "${MPV_LIB_PATH}" AND EXISTS "${MPV_JNI_SOURCE}")
  find_library(EGL_LIB EGL)
  find_library(GLES3_LIB GLESv3)

  add_library(mpv SHARED IMPORTED)
  set_target_properties(mpv PROPERTIES IMPORTED_LOCATION "${MPV_LIB_PATH}")

  target_include_directories(${PACKAGE_NAME} PRIVATE
    src/main/cpp
    "${MPV_INCLUDE_DIR}"
  )
  target_compile_definitions(${PACKAGE_NAME} PRIVATE JELLYFUSE_MPV_LINKED=1)

  target_link_libraries(
    ${PACKAGE_NAME}
    mpv
    ${LOG_LIB}
    ${ANDROID_LIB}
    ${EGL_LIB}
    ${GLES3_LIB}
  )
else()
  target_include_directories(${PACKAGE_NAME} PRIVATE src/main/cpp)
  target_link_libraries(
    ${PACKAGE_NAME}
    ${LOG_LIB}
    ${ANDROID_LIB}
  )
  message(STATUS
    "NativeMpv: libmpv not linked — "
    "${MPV_LIB_PATH} missing or JNI source absent. Build the stubs only."
  )
endif()
