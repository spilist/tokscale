import { render } from "@opentui/solid";
import { App } from "./App.js";

export async function launchTUI() {
  await render(() => <App />, {
    exitOnCtrlC: false,
    useAlternateScreen: true,
    useMouse: true,
    targetFps: 60,
    useKittyKeyboard: {},
  } as any);
}
