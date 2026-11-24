import type { App } from "obsidian";
import type { AgentRecord } from "../shared/types.ts";
import { renderAvatar } from "../plugin/ui-elements.ts";
import { MOBILE_AVATARS } from "./avatar-data.ts";

type PhoneAgent = AgentRecord & {
  avatarBuiltinId?: string;
  avatarImageVersion?: string | null;
};
type AvatarImage = { mime: string; data: string };
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

export class PhoneAvatars {
  private images = new Map<string, { version: string; source: Promise<string | undefined> }>();

  constructor(
    private app: App,
    private getImage: (agentId: string, version: string) => Promise<AvatarImage | null>,
  ) {}

  private signature(agent: PhoneAgent) {
    return JSON.stringify([agent.avatar, agent.avatarBuiltinId, agent.avatarImageVersion, agent.name]);
  }

  render(parent: HTMLElement, agent: PhoneAgent) {
    const version = typeof agent.avatarImageVersion === "string" ? agent.avatarImageVersion : undefined;
    const builtin = agent.avatarBuiltinId;
    const avatar = builtin && Object.hasOwn(MOBILE_AVATARS, builtin)
      ? "builtin:" + builtin
      : agent.avatarImageVersion !== undefined ? agent.name.slice(0, 1) : agent.avatar;
    const node = renderAvatar(parent, this.app, { ...agent, avatar }, "", MOBILE_AVATARS);
    node.dataset.phoneAvatar = agent.id;
    node.dataset.phoneAvatarSignature = this.signature(agent);
    if (version) {
      void this.image(agent.id, version).then((source) => {
        if (!source || !node.isConnected) return;
        const image = node.ownerDocument.createElement("img");
        image.alt = "";
        image.addEventListener("load", () => {
          if (node.isConnected) node.replaceChildren(image);
        }, { once: true });
        image.src = source;
      });
    }
    return node;
  }

  refresh(root: HTMLElement, agents: PhoneAgent[]) {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    for (const [id, cached] of this.images) {
      if (byId.get(id)?.avatarImageVersion !== cached.version) this.images.delete(id);
    }
    for (const node of root.querySelectorAll<HTMLElement>("[data-phone-avatar]")) {
      const agent = byId.get(node.dataset.phoneAvatar ?? "");
      if (!agent || this.signature(agent) === node.dataset.phoneAvatarSignature) continue;
      const replacement = root.ownerDocument.createElement("div");
      node.replaceWith(this.render(replacement, agent));
    }
  }

  private image(id: string, version: string) {
    const cached = this.images.get(id);
    if (cached?.version === version) return cached.source;
    const source = this.getImage(id, version)
      .then((image) => {
        if (!image || !IMAGE_MIME.has(image.mime) || typeof image.data !== "string" ||
            image.data.length > 4 * Math.ceil(2 * 1024 * 1024 / 3) ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))
          return undefined;
        return "data:" + image.mime + ";base64," + image.data;
      })
      .catch(() => undefined);
    this.images.set(id, { version, source });
    void source.then((value) => {
      if (!value && this.images.get(id)?.source === source) this.images.delete(id);
    });
    return source;
  }
}
