// Launcher settings. Put your own changes in config.local.js (gitignored, same shape: any key
// set there replaces the one here), then reinstall with `npm run deploy`.
var LAUNCHER_CONFIG = {
  // The dock, left to right.
  //   title:   name (also the fallback label)
  //   match:   app ids or names, case-insensitive; the first installed one wins.
  //            Find ids with `npm run apps`.
  //   source:  a TV input instead of an app: 'HDMI1', 'HDMI2', ... or the input's name on the TV
  //   image:   logo file (img/..., fetched by `npm run logos`), or 'icon' for the app's own icon
  //   fit:     'mark' places a logo with the sizing system; 'cover' fills the tile
  //   bg:      tile background behind the logo ('auto' samples the image's corner)
  //   art:     drawn fallback from art.js, shown when the image is missing
  //   accent:  glow color while focused
  favorites: [
    { title: 'PlayStation 5', source: 'HDMI1', image: 'img/logo-playstation.svg', fit: 'mark', bg: 'linear-gradient(160deg, #2a7bf0 0%, #0050c8 55%, #002f87 100%)', art: 'ps5', accent: '#1f6fe0' },
    { title: 'Netflix', match: ['org.tizen.netflix-app', 'Netflix'], image: 'img/logo-netflix.svg', fit: 'mark', optical: 1.1, bg: 'linear-gradient(160deg, #1c1c1c 0%, #000 100%)', accent: '#e50914' },
    { title: 'Disney+', match: ['MCmYXNxgcu.DisneyPlus', 'Disney+'], image: 'img/logo-disneyplus.svg', fit: 'mark', bg: 'linear-gradient(170deg, #0a1b38 0%, #0b3b58 55%, #12a3b8 120%)', art: 'disney', accent: '#1fb1c9' },
    { title: 'Prime Video', match: ['org.tizen.primevideo', 'Prime Video'], image: 'img/logo-primevideo.svg', fit: 'mark', bg: 'linear-gradient(160deg, #1a8cff 0%, #0068e0 100%)', art: 'prime', accent: '#1a98ff' },
    { title: 'YouTube', match: ['9Ur5IzDKqV.TizenYouTube', 'YouTube'], image: 'img/logo-youtube.svg', fit: 'mark', bg: 'linear-gradient(160deg, #262626 0%, #0f0f0f 100%)', art: 'youtube', accent: '#ff0033' },
    { title: 'Spotify', match: ['rJeHak5zRg.Spotify', 'Spotify'], image: 'img/logo-spotify.svg', fit: 'mark', bg: 'linear-gradient(160deg, #22e06a 0%, #1db954 100%)', accent: '#1ed760' },
    { title: 'Instagram', match: ['zigzSWa1hy.InstagramAirwave', 'Instagram'], image: 'img/logo-instagram.svg', fit: 'mark', bg: 'radial-gradient(130% 150% at 28% 112%, #fdf497 0%, #fdf497 8%, #fd5949 42%, #d6249f 64%, #285aeb 100%)', art: 'instagram', accent: '#d6249f' }
  ],

  // Hide dock tiles whose app isn't installed (otherwise they show dimmed).
  hideMissing: true,

  // Wallpapers: images in wallpapers/ (added by `npm run wallpapers`), one crossfading to the
  // next every `minutes`. With none, built-in gradients are used.
  wallpapers: { minutes: 5 },

  // Weather in the clock pill (Open-Meteo, no key). Set your latitude/longitude to turn it on.
  weather: { latitude: null, longitude: null, units: 'fahrenheit' },

  clock24h: false,

  // Input kept behind the launcher, e.g. 'HDMI1'. The TV shows its last input for a moment at
  // power-on; an empty one says "cable disconnected", an antenna without signal shows static.
  // A soundbar's ARC port usually shows plain black. null leaves the input alone.
  idleSource: null,

  // The launcher runs in the background and comes back when Samsung's home shows up (after
  // leaving an app) and when the TV is turned on. false turns either off.
  returnToLauncher: true,
  launcherOnPowerOn: true,

  // App ids for other TV models, if the defaults don't match yours:
  //   samsungHomeIds: ['com.samsung.tv.csfs'],     Samsung's home
  //   inputViewerId: 'org.tizen.tv-viewer',        shows HDMI inputs
  //   wakeScreenIds: [...]                         first screens at power-on (input viewer + home)
};
