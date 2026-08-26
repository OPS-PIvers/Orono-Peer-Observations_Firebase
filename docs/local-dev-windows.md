# Running the Firebase emulators on Windows

The Firestore emulator can fail to start on Windows with an error that looks
like a Firebase or JDK version problem but is neither. This documents the
actual cause, the fix, and how to check whether a machine is affected — so the
next person doesn't re-derive it from scratch.

## Symptom

```
!  firestore: Fatal error occurred:
   Firestore Emulator has exited with code: 1,
   stopping all running emulators
```

`firestore-debug.log` has the real stack:

```
io.netty.channel.ChannelException: failed to open a new selector
Caused by: java.io.IOException: Unable to establish loopback connection
Caused by: java.net.SocketException: Invalid argument: connect
    at java.base/sun.nio.ch.UnixDomainSockets.connect0(Native Method)
```

## What is actually happening

Nothing Firebase-specific. The emulator is a Java process, and on this machine
**no Java program can open a `java.nio.channels.Selector` at all.**

The chain, all inside the JDK:

1. Since JDK 13, Windows uses `WEPollSelectorProvider`. `WEPollSelectorImpl`
   builds an internal `Pipe` with the AF_UNIX flag hardcoded to `true`.
2. `PipeImpl` auto-binds a listener socket in a temp directory, then connects
   to it over the loopback.
3. `sun.nio.ch.UnixDomainSocketsUtil.getTempDir()` picks that directory in this
   order: the `jdk.net.unixdomain.tmpdir` **system property**, then the same
   name as a **net property** (`$JAVA_HOME/conf/net.properties`), then
   **`%TEMP%`**, then `java.io.tmpdir`.
4. `%TEMP%` is under the user profile. On this machine `AF_UNIX` sockets under
   the user profile can be created and bound but **not connected to** —
   `connect()` returns `Invalid argument`. `PipeImpl` only falls back to a TCP
   loopback pair when the **bind** fails, so a bind that succeeds and a connect
   that fails is unrecoverable.
5. Netty can't create a selector, and the emulator exits 1.

AF_UNIX is not broken machine-wide — it works fine outside the user profile.
The likely culprit is endpoint-security or DLP software filtering the profile
directory. Worth raising with district IT, since it affects any Java NIO
program, not just Firebase.

## Fix

Two independent things are needed:

**1. Java 21+ on PATH.** `firebase-tools` refuses anything older
("firebase-tools no longer supports Java version before 21"). JDK 21 is already
installed at `C:\Program Files\Microsoft\jdk-21.0.10.7-hotspot`; `JAVA_HOME`
just needs to point at it instead of the JDK 17 alongside it.

**2. An AF_UNIX temp directory outside the user profile.** Point `%TEMP%` at
one — `C:\Windows\Temp` is verified working here, and any directory outside
the profile that the account can write to will do.

Both are handled automatically by `scripts/run-firebase-emulators.mjs`, which
`pnpm dev:emulators` and `pnpm test:rules` go through. It resolves a JDK 21+
from `JAVA_HOME` (falling back to scanning the usual install roots), puts its
`bin` first on `PATH` for the child — `firebase-tools` spawns a bare `java` and
ignores `JAVA_HOME` — and sets `TEMP`/`TMP` to a non-profile directory. Nothing
is set globally, and non-Windows platforms are untouched.

Two traps worth knowing:

- Do **not** reach for `-Djava.io.tmpdir`. Per the resolution order above,
  `%TEMP%` outranks it, so it has no effect here.
- Do **not** set `-Djdk.net.unixdomain.tmpdir` through `JAVA_TOOL_OPTIONS`.
  It works, but the JVM prints `Picked up JAVA_TOOL_OPTIONS: ...` to stderr on
  every launch, and firebase-tools parses the rules runtime's stderr — the
  banner comes back as `Unexpected rules runtime error`. Setting the
  environment variable is silent.

## Checking whether a machine is affected

`SelTest.java` — if this fails, the emulator will fail, and the fix above is
the one you want:

```java
import java.nio.channels.Selector;

public class SelTest {
  public static void main(String[] a) throws Exception {
    try (Selector s = Selector.open()) {
      System.out.println("selector OK: " + s.getClass().getName());
    }
  }
}
```

```bash
java SelTest.java                            # fails here
TEMP=C:\Windows\Temp java SelTest.java       # succeeds
```

## What this was NOT

`apps/web/.env.local` carried a note saying emulators don't run on this machine
because of a "Firestore emulator UDS bug under JDK 21+", and local work went
against live Firebase instead. That diagnosis was wrong on both counts:

- **Not a JDK 21 regression.** JDK 17 fails identically — it uses the same
  WEPoll selector and the same AF_UNIX pipe. Under 17 you never see it because
  `firebase-tools` rejects the Java version before the emulator ever starts,
  which produces a different and misleading error.
- **Not a firebase-tools bug.** The failure is below Firebase entirely, in the
  JVM's NIO layer. Upgrading `firebase-tools` does not change it.

With the wrapper in place, `pnpm dev:emulators` and `pnpm test:rules` work
locally with no manual environment setup — `pnpm test:rules` runs its full 109
rules specs against the emulator.

## Still rough locally: the Functions emulator

`pnpm test:e2e` gets most of the way but the Functions emulator does not
reliably load user code on this machine — it gives up with `Cannot determine
backend specification. Timeout after 10000` while resolving the functions'
`defineString()` params. Specs behind special access (anything needing the
`syncMyClaims` callable to mint claims) fail as a result; the rest pass. CI runs
the same suite on Ubuntu, where it works. Two things to check first if you pick
this up:

- `apps/functions/lib/node_modules` is written by `npm install` inside `lib`,
  separately from the pnpm workspace, and goes stale. Rebuild it with
  `pnpm build:functions:deploy`.
- The emulator needs every `defineString()` param present in
  `apps/functions/lib/.env.local` and every secret in `.secret.local`, or it
  blocks on a stdin prompt. See the "offline Functions params" step in
  `.github/workflows/ci.yml` for the list.
