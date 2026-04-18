package com.margelo.nitro.nativempv

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager
import com.margelo.nitro.nativempv.views.HybridMpvVideoViewManager

class NativeMpvPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return null
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider { HashMap() }
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<out android.view.View, out ReactShadowNode<*>>> {
    return listOf(HybridMpvVideoViewManager())
  }

  companion object {
    init {
      System.loadLibrary("NativeMpv")
    }
  }
}
