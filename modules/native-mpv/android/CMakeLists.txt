project(NativeMpv)
cmake_minimum_required(VERSION 3.9.0)

set(PACKAGE_NAME NativeMpv)
set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

# mpv_jni.cpp is always compiled — it guards its libmpv calls behind
# the JELLYFUSE_MPV_LINKED macro so the stubs-only build (when no
# libmpv tarball is available) still links cleanly. The guard is
# flipped on below once we confirm the vendored libmpv.so + headers
# exist for the current ABI.
add_library(${PACKAGE_NAME} SHARED
  src/main/cpp/cpp-adapter.cpp
  src/main/cpp/mpv_jni.cpp
)

# Nitrogen autolinking (unchanged from Phase A).
include(${CMAKE_SOURCE_DIR}/../nitrogen/generated/android/NativeMpv+autolinking.cmake)

# ── vendored libmpv-android ───────────────────────────────────────────────
# The `fetchLibmpvAndroid` Gradle task runs before us and populates
# vendor/android/{include,<abi>/}. When the tarball is missing (fresh
# clone without 1Password access), mpv_jni.cpp falls back to stub
# behavior via the JELLYFUSE_MPV_LINKED guard.
set(MPV_VENDOR_DIR "${CMAKE_SOURCE_DIR}/../vendor/android")
set(MPV_LIB_PATH "${MPV_VENDOR_DIR}/${CMAKE_ANDROID_ARCH_ABI}/libmpv.so")
set(MPV_INCLUDE_DIR "${MPV_VENDOR_DIR}/include")

find_library(LOG_LIB log)
find_library(ANDROID_LIB android)

target_include_directories(${PACKAGE_NAME} PRIVATE src/main/cpp)

if(EXISTS "${MPV_LIB_PATH}")
  find_library(EGL_LIB EGL)
  find_library(GLES3_LIB GLESv3)

  add_library(mpv SHARED IMPORTED)
  set_target_properties(mpv PROPERTIES IMPORTED_LOCATION "${MPV_LIB_PATH}")

  target_include_directories(${PACKAGE_NAME} PRIVATE "${MPV_INCLUDE_DIR}")
  target_compile_definitions(${PACKAGE_NAME} PRIVATE JELLYFUSE_MPV_LINKED=1)

  target_link_libraries(
    ${PACKAGE_NAME}
    mpv
    ${LOG_LIB}
    ${ANDROID_LIB}
    ${EGL_LIB}
    ${GLES3_LIB}
  )
  message(STATUS "NativeMpv: libmpv linked from ${MPV_LIB_PATH}")
else()
  target_link_libraries(
    ${PACKAGE_NAME}
    ${LOG_LIB}
    ${ANDROID_LIB}
  )
  message(STATUS
    "NativeMpv: libmpv not linked — ${MPV_LIB_PATH} missing. "
    "mpv_jni.cpp compiles as stubs-only; MpvBridge.isLinked() returns false."
  )
endif()
