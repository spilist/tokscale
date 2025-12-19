declare module "string-width" {
  export default function stringWidth(str: string): number;
}

declare module "./tui-bundle.js" {
  import type { TUIOptions } from "./tui/types/index.js";
  export function launchTUI(options?: TUIOptions): Promise<void>;
  export type { TUIOptions };
}

declare module "bun" {
  export interface BunSubprocess {
    stdin: any;
    stdout: any;
    stderr: any;
    exited: Promise<number>;
    kill(signal?: string): void;
  }

  export function spawn(options: {
    cmd: string[];
    stdin?: "pipe";
    stdout?: "pipe";
    stderr?: "pipe";
    timeout?: number;
    killSignal?: string;
  }): BunSubprocess;
}
