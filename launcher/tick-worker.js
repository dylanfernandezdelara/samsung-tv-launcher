// Ticks every 50 ms from a worker thread: page timers are slowed while the launcher is in the
// background, worker timers much less, so the foreground check reacts within a frame or two.
setInterval(function () { postMessage(0); }, 50);
