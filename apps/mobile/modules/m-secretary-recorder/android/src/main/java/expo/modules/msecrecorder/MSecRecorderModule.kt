package expo.modules.msecrecorder

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MSecRecorderModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("MSecRecorder")

    Events(
      RecordingService.EVENT_STARTED,
      RecordingService.EVENT_STOPPED,
      RecordingService.EVENT_CHUNK_READY,
      RecordingService.EVENT_ERROR,
    )

    OnCreate {
      RecordingService.listener = { event, payload ->
        try {
          sendEvent(event, payload)
        } catch (_: Exception) {
          // module may be torn down before service finishes
        }
      }
    }

    OnDestroy {
      RecordingService.listener = null
    }

    AsyncFunction("start") { chunkLengthSec: Int ->
      val ctx = appContext.reactContext ?: error("No react context")
      val intent = Intent(ctx, RecordingService::class.java).apply {
        action = RecordingService.ACTION_START
        putExtra(RecordingService.EXTRA_CHUNK_LEN, chunkLengthSec)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      // Force lambda return type to Unit — startService/startForegroundService
      // return ComponentName? which Expo Modules cannot serialize across the bridge.
      Unit
    }

    AsyncFunction("stop") {
      val ctx = appContext.reactContext ?: error("No react context")
      val intent = Intent(ctx, RecordingService::class.java).apply {
        action = RecordingService.ACTION_STOP
      }
      ctx.startService(intent)
      Unit
    }

    AsyncFunction("pause") {
      val ctx = appContext.reactContext ?: error("No react context")
      val intent = Intent(ctx, RecordingService::class.java).apply {
        action = RecordingService.ACTION_PAUSE
      }
      ctx.startService(intent)
      Unit
    }

    AsyncFunction("resume") {
      val ctx = appContext.reactContext ?: error("No react context")
      val intent = Intent(ctx, RecordingService::class.java).apply {
        action = RecordingService.ACTION_RESUME
      }
      ctx.startService(intent)
      Unit
    }

    Function("isRunning") {
      RecordingService.INSTANCE != null
    }
  }
}
