// Package the launcher as a Windows x64 app from Linux, then flip Electron's
// fuses so the exe cannot be repurposed (no "run as plain Node", no inspector
// flags, only the signed-off app.asar may load).
import { packager } from '@electron/packager';
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses';
import path from 'node:path';

const [out] = await packager({
  dir: '.',
  name: 'WinTV',
  executableName: 'WinTV',
  platform: 'win32',
  arch: 'x64',
  out: 'dist',
  overwrite: true,
  asar: true,
  prune: true,
  ignore: [/^\/dist($|\/)/, /^\/build\.mjs$/],
  win32metadata: { CompanyName: 'WinTV', FileDescription: 'WinTV home screen', ProductName: 'WinTV' },
});

await flipFuses(path.join(out, 'WinTV.exe'), {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
});
console.log(out);
