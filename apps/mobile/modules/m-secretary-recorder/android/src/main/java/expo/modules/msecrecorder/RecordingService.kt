package expo.modules.msecrecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Foreground service that owns the MediaRecorder and rotates output files
 * every chunkLengthSec seconds using setNextOutputFile() — gapless on
 * Android 8+. State is shared with MSecRecorderModule via the companion
 * object so Kotlin can call back into JS.
 */
class RecordingService : Service() {

  private var recorder: MediaRecorder? = null
  private var currentFile: File? = null
  private var currentChunkStartedAtSec: Long = 0
  private val running = AtomicBoolean(false)
  private val chunkIndex = AtomicInteger(0)
  private val mainHandler = Handler(Looper.getMainLooper())
  private var rollRunnable: Runnable? = null
  private var startedAtMs: Long = 0
  private var pausedDurationMs: Long = 0
  private var pausedAtMs: Long = 0
  private var paused = false
  private var wakeLock: PowerManager.WakeLock? = null

  private var chunkLengthSec: Int = 300
  private lateinit var meetingsDir: File

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    meetingsDir = File(filesDir, "meetings").apply { mkdirs() }
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        chunkLengthSec = intent.getIntExtra(EXTRA_CHUNK_LEN, 300)
        startForeground(NOTIFICATION_ID, buildNotification("กำลังบันทึกการประชุม"))
        beginRecording()
      }
      ACTION_STOP -> {
        stopRecording()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
      ACTION_PAUSE -> pauseRecording()
      ACTION_RESUME -> resumeRecording()
    }
    return START_STICKY
  }

  // ── recorder lifecycle ─────────────────────────────────────

  private fun beginRecording() {
    if (running.get()) return
    acquireWakeLock()
    startedAtMs = System.currentTimeMillis()
    pausedDurationMs = 0
    chunkIndex.set(0)
    try {
      currentFile = newChunkFile(chunkIndex.get())
      currentChunkStartedAtSec = 0
      recorder = createRecorder(currentFile!!).also { it.start() }
      running.set(true)
      scheduleRoll()
      INSTANCE = this
      listener?.invoke(EVENT_STARTED, mapOf())
    } catch (e: Exception) {
      Log.e(TAG, "beginRecording failed", e)
      listener?.invoke(EVENT_ERROR, mapOf("message" to (e.message ?: "unknown")))
      cleanup()
    }
  }

  private fun stopRecording() {
    if (!running.get()) return
    running.set(false)
    rollRunnable?.let { mainHandler.removeCallbacks(it) }
    rollRunnable = null
    val finishedFile = currentFile
    val startedAt = currentChunkStartedAtSec
    val endedAt = elapsedSec()
    try {
      recorder?.apply {
        stop()
        release()
      }
    } catch (e: Exception) {
      Log.w(TAG, "recorder.stop threw (likely empty chunk)", e)
    }
    recorder = null
    if (finishedFile != null && finishedFile.exists() && finishedFile.length() > 0) {
      emitChunkReady(finishedFile, startedAt, endedAt, chunkIndex.get())
    }
    cleanup()
    listener?.invoke(EVENT_STOPPED, mapOf())
  }

  private fun pauseRecording() {
    if (!running.get() || paused) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      try {
        recorder?.pause()
        paused = true
        pausedAtMs = System.currentTimeMillis()
        rollRunnable?.let { mainHandler.removeCallbacks(it) }
      } catch (e: Exception) {
        Log.w(TAG, "pause failed", e)
      }
    }
  }

  private fun resumeRecording() {
    if (!running.get() || !paused) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      try {
        recorder?.resume()
        pausedDurationMs += System.currentTimeMillis() - pausedAtMs
        paused = false
        scheduleRoll()
      } catch (e: Exception) {
        Log.w(TAG, "resume failed", e)
      }
    }
  }

  /**
   * Rotate to a new chunk file using setNextOutputFile — the underlying
   * encoder keeps writing without gap. After the swap fires
   * MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED we finalize the previous
   * file, emit a chunk-ready event, and queue the next rotation.
   */
  private fun scheduleRoll() {
    rollRunnable?.let { mainHandler.removeCallbacks(it) }
    val r = Runnable {
      if (!running.get() || paused) return@Runnable
      try {
        val nextIdx = chunkIndex.get() + 1
        val nextFile = newChunkFile(nextIdx)
        val rec = recorder ?: return@Runnable
        rec.setNextOutputFile(nextFile)
        // The OnInfoListener will switch currentFile when the rollover
        // actually starts; nextFile is staged.
        pendingNextFile = nextFile
      } catch (e: Exception) {
        Log.e(TAG, "scheduleRoll prepare failed", e)
        listener?.invoke(EVENT_ERROR, mapOf("message" to (e.message ?: "rotate failed")))
      }
    }
    rollRunnable = r
    mainHandler.postDelayed(r, chunkLengthSec * 1000L)
  }

  private fun createRecorder(out: File): MediaRecorder {
    val rec = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      MediaRecorder(this)
    } else {
      @Suppress("DEPRECATION")
      MediaRecorder()
    }
    rec.setAudioSource(MediaRecorder.AudioSource.MIC)
    rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
    rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
    rec.setAudioSamplingRate(16000)
    rec.setAudioChannels(1)
    rec.setAudioEncodingBitRate(64000)
    rec.setOutputFile(out)
    rec.setOnInfoListener { _, what, _ ->
      if (what == MediaRecorder.MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED) {
        onNextFileStarted()
      }
    }
    rec.setOnErrorListener { _, what, extra ->
      Log.e(TAG, "MediaRecorder error what=$what extra=$extra")
      listener?.invoke(EVENT_ERROR, mapOf("message" to "recorder.error what=$what"))
    }
    rec.prepare()
    return rec
  }

  private var pendingNextFile: File? = null

  private fun onNextFileStarted() {
    val finished = currentFile
    val nextFile = pendingNextFile ?: return
    val startedAt = currentChunkStartedAtSec
    val endedAt = elapsedSec()
    val idx = chunkIndex.getAndIncrement()
    currentFile = nextFile
    currentChunkStartedAtSec = endedAt
    pendingNextFile = null
    if (finished != null && finished.exists() && finished.length() > 0) {
      emitChunkReady(finished, startedAt, endedAt, idx)
    }
    scheduleRoll()
  }

  private fun emitChunkReady(file: File, startedAtSec: Long, endedAtSec: Long, idx: Int) {
    listener?.invoke(
      EVENT_CHUNK_READY,
      mapOf(
        "fileUri" to "file://${file.absolutePath}",
        "chunkIndex" to idx,
        "startedAtSec" to startedAtSec.toInt(),
        "endedAtSec" to endedAtSec.toInt(),
        "durationSec" to (endedAtSec - startedAtSec).toInt(),
        "fileSizeBytes" to file.length(),
      ),
    )
  }

  private fun newChunkFile(idx: Int): File {
    val ts = System.currentTimeMillis()
    return File(meetingsDir, "${ts}_${idx}.m4a")
  }

  private fun elapsedSec(): Long {
    val now = System.currentTimeMillis()
    val active = (now - startedAtMs - pausedDurationMs - if (paused) (now - pausedAtMs) else 0L)
    return active / 1000L
  }

  // ── notification ────────────────────────────────────────────

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(
        CHANNEL_ID,
        "M-Secretary Recording",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "แจ้งเตือนระหว่างบันทึกการประชุม"
        setShowBadge(false)
      }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(ch)
    }
  }

  private fun buildNotification(text: String): Notification {
    val openIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pi = openIntent?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val appIcon = applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_btn_speak_now
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("M-Secretary")
      .setContentText(text)
      .setSmallIcon(appIcon)
      .setOngoing(true)
      .setContentIntent(pi)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  // ── plumbing ────────────────────────────────────────────────

  private fun acquireWakeLock() {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MSec::Recording").apply {
      setReferenceCounted(false)
      acquire(12 * 60 * 60 * 1000L /* 12h cap */)
    }
  }

  private fun cleanup() {
    try { wakeLock?.release() } catch (_: Exception) {}
    wakeLock = null
    paused = false
    pendingNextFile = null
    if (INSTANCE === this) INSTANCE = null
  }

  override fun onDestroy() {
    super.onDestroy()
    if (running.get()) stopRecording()
  }

  companion object {
    private const val TAG = "MSecRecording"
    const val ACTION_START = "expo.modules.msecrecorder.START"
    const val ACTION_STOP = "expo.modules.msecrecorder.STOP"
    const val ACTION_PAUSE = "expo.modules.msecrecorder.PAUSE"
    const val ACTION_RESUME = "expo.modules.msecrecorder.RESUME"
    const val EXTRA_CHUNK_LEN = "chunkLengthSec"

    const val EVENT_STARTED = "onStarted"
    const val EVENT_STOPPED = "onStopped"
    const val EVENT_CHUNK_READY = "onChunkReady"
    const val EVENT_ERROR = "onError"

    private const val CHANNEL_ID = "msec.recording"
    private const val NOTIFICATION_ID = 4711

    @Volatile var INSTANCE: RecordingService? = null
    @Volatile var listener: ((String, Map<String, Any?>) -> Unit)? = null
  }
}
