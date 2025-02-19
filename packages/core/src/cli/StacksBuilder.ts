import chokidar from "chokidar";
import { interpret, actions, assign, createMachine } from "xstate";
import { Config } from "../config";
import { Stacks } from "../stacks";
import { synth } from "../";
import path from "path";
import fs from "fs-extra";
import crypto from "crypto";

type Events =
  | { type: "FILE_CHANGE" }
  | { type: "TRIGGER_DEPLOY" }
  | { type: "BUILD_SUCCESS" }
  | {
      type: "done.invoke.synth";
      data: string;
    };

type Context = {
  dirty: boolean;
  deployedHash: string;
  pendingHash: string;
};

function stub(name: string, duration = 1000) {
  return function () {
    console.log(name);
    return new Promise((r) => setTimeout(r, duration));
  };
}

const machine = createMachine<Context, Events>(
  {
    initial: "idle",
    id: "stacksBuilder",
    states: {
      idle: {
        initial: "none",
        on: {
          FILE_CHANGE: "building",
        },
        states: {
          none: {},
          unchanged: {},
          deployed: {},
        },
      },
      failed: {
        on: {
          FILE_CHANGE: "building",
        },
        states: {
          build: {},
          synth: {},
          deploy: {},
        },
      },
      building: {
        entry: assign<Context>({
          dirty: () => false,
        }),
        invoke: {
          src: "build",
          onDone: [
            {
              cond: "isDirty",
              target: "building",
            },
            {
              target: "synthing",
            },
          ],
          onError: [
            {
              cond: "isDirty",
              target: "building",
            },
            {
              target: "failed.build",
            },
          ],
        },
      },
      synthing: {
        invoke: {
          src: "synth",
          onDone: [
            {
              cond: "isDirty",
              target: "building",
            },
            {
              cond: "isChanged",
              target: "deployable",
              actions: actions.assign({
                pendingHash: (_, evt) => evt.data,
              }),
            },
            {
              target: "idle.unchanged",
            },
          ],
          onError: [
            {
              cond: "isDirty",
              target: "building",
            },
            {
              target: "failed.synth",
            },
          ],
        },
      },
      deployable: {
        on: {
          TRIGGER_DEPLOY: "deploying",
          FILE_CHANGE: "building",
        },
      },
      deploying: {
        invoke: {
          src: "deploy",
          onDone: [
            {
              cond: "isDirty",
              target: "building",
              actions: actions.assign({
                deployedHash: (ctx) => ctx.pendingHash,
              }),
            },
            {
              target: "idle.deployed",
              actions: actions.assign({
                deployedHash: (ctx) => ctx.pendingHash,
              }),
            },
          ],
          onError: [
            {
              cond: "isDirty",
              target: "building",
            },
            {
              target: "failed.deploy",
            },
          ],
        },
      },
    },
    on: {
      FILE_CHANGE: {
        actions: actions.assign({
          dirty: (_ctx) => true,
        }),
      },
    },
  },
  {
    services: {
      build: stub("build"),
      deploy: stub("deploy"),
      synth: stub("synth"),
    },
    guards: {
      isDirty,
      isChanged,
    },
  }
);

// TODO: The arguments here are hacky because we need to access code from cdkHelper. Should be refactored so that cdkHelpers don't really exist and everything is done inside here.
export function useStacksBuilder(
  root: string,
  config: Config,
  cdkOptions: any,
  deployFunc: any
) {
  const cdkOutPath = path.join(root, cdkOptions.output);
  const service = interpret(
    machine
      .withConfig({
        services: {
          build: async () => {
            await Stacks.build(root, config);
          },
          synth: async () => {
            await synth(cdkOptions);
            return generateChecksum(cdkOutPath);
          },
          deploy: async () => {
            await deployFunc(cdkOptions);
          },
        },
      })
      .withContext({
        dirty: false,
        pendingHash: "",
        deployedHash: generateChecksum(cdkOutPath),
      })
  );
  chokidar
    .watch(path.dirname(config.main) + "/**/*", {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
    })
    .on("change", () => {
      service.send("FILE_CHANGE");
    });
  service.start();
  return service;
}

function isChanged(ctx: Context, evt: Events) {
  if (evt.type === "done.invoke.synth") return evt.data !== ctx.deployedHash;
  return false;
}

function isDirty(ctx: Context) {
  return ctx.dirty;
}

function generateChecksum(cdkOutPath: string) {
  const manifestPath = path.join(cdkOutPath, "manifest.json");
  const cdkManifest = fs.readJsonSync(manifestPath);
  const checksumData = Object.keys(cdkManifest.artifacts)
    .filter(
      (key: string) =>
        cdkManifest.artifacts[key].type === "aws:cloudformation:stack"
    )
    .map((key: string) => {
      const { templateFile } = cdkManifest.artifacts[key].properties;
      const templatePath = path.join(cdkOutPath, templateFile);
      const templateContent = fs.readFileSync(templatePath);
      return templateContent;
    })
    .join("\n");
  const hash = crypto.createHash("sha256").update(checksumData).digest("hex");
  return hash;
}
