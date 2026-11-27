import type { App } from "obsidian";
import type { AgentRecord, Conversation, RunProgress } from "../shared/types.ts";
import {
  createAvatarMotionController,
  DEFAULT_AVATAR_IDLE,
  type AvatarMotionController,
  type AvatarMotionState,
  type AvatarRenderOptions,
} from "../plugin/avatar-motion.ts";
import { emotionForProgress, isBuiltinAvatarId } from "../shared/emotion-ball/index.ts";
import { renderAvatar } from "../plugin/ui-elements.ts";
import { MOBILE_AVATARS } from "./avatar-data.ts";

type PhoneAgent = AgentRecord & {
  avatarBuiltinId?: string;
  avatarImageVersion?: string | null;
};
type AvatarImage = { mime: string; data: string };
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

type ChatAvatarStatus = Pick<Conversation, "id" | "status">;
type ChatAvatarProgress = Pick<RunProgress, "phase" | "toolName">;

export class PhoneAvatars {
  private chat?: {
    node: HTMLElement;
    motion?: AvatarMotionController;
    conversationId?: string;
    status?: Conversation["status"];
  };
  private images = new Map<string, { version: string; source: Promise<string | undefined> }>();

  constructor(
    private app: App,
    private getImage: (agentId: string, version: string) => Promise<AvatarImage | null>,
  ) {}

  private signature(agent: PhoneAgent) {
    return JSON.stringify([agent.avatar, agent.avatarBuiltinId, agent.avatarImageVersion, agent.name]);
  }

  render(parent: HTMLElement, agent: PhoneAgent, motion?: AvatarRenderOptions) {
    const version = typeof agent.avatarImageVersion === "string" ? agent.avatarImageVersion : undefined;
    const builtin = agent.avatarBuiltinId;
    const avatar = builtin && isBuiltinAvatarId(builtin)
      ? "builtin:" + builtin
      : agent.avatarImageVersion !== undefined ? agent.name.slice(0, 1) : agent.avatar;
    const node = renderAvatar(parent, this.app, { ...agent, avatar }, "", MOBILE_AVATARS, motion);
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

  updateChat(
    parent: HTMLElement,
    agent: PhoneAgent,
    conversation?: ChatAvatarStatus,
    progress?: ChatAvatarProgress,
    waiting = false,
  ) {
    const signature = this.signature(agent);
    const previous = this.chat;
    if (previous?.node.parentElement !== parent ||
        previous.node.dataset.phoneAvatar !== agent.id ||
        previous.node.dataset.phoneAvatarSignature !== signature) {
      this.clearChat();
      const node = this.render(parent, agent, { live: true, idle: DEFAULT_AVATAR_IDLE });
      parent.prepend(node);
      const motion = node.classList.contains("pi-eb-avatar")
        ? createAvatarMotionController(node)
        : undefined;
      this.chat = { node, motion };
    }
    const chat = this.chat!;
    const sameConversation = Boolean(conversation && chat.conversationId === conversation.id);
    const wasRunning = sameConversation && chat.status === "running";
    chat.conversationId = conversation?.id;
    chat.status = conversation?.status;

    let state: AvatarMotionState = agent.paused ? "paused" : "idle";
    let emotion: string | undefined;
    if (conversation?.status === "running") {
      state = waiting ? "waiting" : "working";
      emotion = emotionForProgress(progress, { waitingInput: waiting });
    } else if (wasRunning) {
      state = conversation?.status === "failed" ? "error"
        : conversation?.status === "cancelled" ? "cancelled"
        : "complete";
    } else if (sameConversation &&
        ["complete", "cancelled", "error"].includes(chat.node.dataset.avatarState ?? "")) {
      return;
    }

    if (chat.node.dataset.avatarState !== state ||
        (emotion !== undefined && chat.node.dataset.avatarEmotion !== emotion)) {
      chat.motion?.setState(state, emotion);
    }
  }

  clearChat() {
    this.chat?.motion?.disconnect();
    this.chat?.node.remove();
    this.chat = undefined;
  }

  refresh(root: HTMLElement, agents: PhoneAgent[]) {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    for (const [id, cached] of this.images) {
      if (byId.get(id)?.avatarImageVersion !== cached.version) this.images.delete(id);
    }
    for (const node of root.querySelectorAll<HTMLElement>("[data-phone-avatar]")) {
      if (node === this.chat?.node) continue;
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
