export const WIN32_DIRECTORY_ENTRY_MARGIN_KIB = 2;

function skipOnWin32(divergence: string): false | string {
  return process.platform === "win32" ? divergence : false;
}

export function skipUnlessChmodMakesFilesUnreadable(): false | string {
  return skipOnWin32("win32 ignores the POSIX read bit chmod clears, so a file chmod'd unreadable here still reads back readable");
}

export function skipUnlessChmodChangesFileMode(): false | string {
  return skipOnWin32("win32 synthesises its own mode bits, so a file chmod'd here reads back with the mode it already had");
}

export function skipUnlessChmodDeniesDirectoryWrites(): false | string {
  return skipOnWin32(
    "win32 ignores the POSIX write bit chmod clears on a directory, so a directory chmod'd 555 here still accepts a rename into it",
  );
}

export function skipUnlessMkdirHonoursOwnerOnlyMode(): false | string {
  return skipOnWin32(
    "win32 synthesises its own mode bits from FILE_ATTRIBUTE_READONLY and ignores mkdirSync's mode, so a directory created 0o700 here reads back 0o666/0o777 (C2-D9)",
  );
}

export function skipUnlessDiskBlocksAreAllocated(): false | string {
  return skipOnWin32(
    `win32 synthesises st_blocks from a file's allocation size and reports none for a directory entry, so on windows-latest the port sized core/src/install at 116 KiB where Git Bash's du -sk read 117 — a 1 KiB directory-entry delta, under the ${WIN32_DIRECTORY_ENTRY_MARGIN_KIB} KiB margin every retention case here clears the boundary by`,
  );
}

export function skipUnlessKernelRunsScriptFixtures(): false | string {
  return skipOnWin32(
    "win32 has neither #! handling nor the /bin/sh fallback an ENOEXEC exec falls back to — CreateProcessW starts PE images alone, so a script fixture is no program here",
  );
}

export function skipUnlessPathResolvesExtensionlessNames(): false | string {
  return skipOnWin32(
    "win32 resolves a bare command name through PATHEXT alone and starts PE images alone, so neither an extensionless git symlink nor a #! claude stub on an injected PATH is reachable here",
  );
}

export function skipUnlessBashRunsTheInstallerPipeline(): false | string {
  return skipOnWin32(
    "the installer's own region pipeline is bash plus awk plus mktemp, and win32 has no POSIX shell of its own to run it as the oracle — " +
      "the port-only cases beside each guarded one keep the floor on this leg",
  );
}
