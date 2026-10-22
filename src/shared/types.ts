import type { AgentPermissions } from "./permissions.ts";
export type { AgentPermissions } from "./permissions.ts";
export interface AgentDefinition {
  schemaVersion: 1;
  id: string;
  role: "manager" | "folder";
  name: string;
  avatar: string;
  description: string;
  prompt: string;
  model: string;
  skills: string[];
  builtinSkills?: boolean;
  mcpTools: string[];
}
export interface AgentRecord extends AgentDefinition {
  path: string;
  scope: string;
  paused?: string;
}
export interface ApiProviderConfig {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  models: string[];
}
export interface McpServerConfig {
  id: string;
  name: string;
  purpose?: string;
  capabilities?: string;
  /** Legacy metadata, retained for config compatibility; not sent to the model. */
  target?: string;
  targetVault?: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  secretHeadersId?: string;
  access: "manager-only" | "non-filesystem" | "scoped";
  scope?: string;
}
export interface PluginSettings {
  agentPrompts?: Record<string, string>;
  systemPrompts?: import("./prompts.ts").SystemPrompts;
  mobileRemote: { enabled: boolean; port: number };
  agentPermissions: Record<string, AgentPermissions>;
  model: string;
  modelSource: "subscription" | "api";
  skillDirectories: string[];
  apiProviders: ApiProviderConfig[];
  mcpServers: McpServerConfig[];
  weixinEnabled: boolean;
  scopeApprovals: Record<string, string>;
  agentLocations: Record<string, string>;
  contactsOnStartup: boolean;
}
export const DEFAULT_SETTINGS: PluginSettings = {
  mobileRemote: { enabled: false, port: 31759 },
  agentPermissions: {},
  model: "",
  modelSource: "subscription",
  skillDirectories: [],
  apiProviders: [],
  mcpServers: [],
  weixinEnabled: false,
  scopeApprovals: {},
  agentLocations: {},
  contactsOnStartup: true,
};
export interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
  origin?: Conversation["source"];
}
export interface DelegationRecord {
  conversationId: string;
  parentConversationId: string;
  messageIndex: number;
  fromAgentId: string;
  toAgentId: string;
  task: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress?: string;
  result?: string;
  error?: string;
  updatedAt: string;
}
export interface ToolEvent {
  name: string;
  status: "running" | "completed" | "failed";
  detail?: string;
  taskId: string;
  messageIndex?: number;
}
export interface Conversation {
  id: string;
  agentId: string;
  source: "desktop" | "weixin" | "delegation" | "mobile";
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
  events: ToolEvent[];
  status: "idle" | "running" | "failed" | "cancelled";
  piSessionFile?: string;
  delegations?: DelegationRecord[];
  parent?: { conversationId: string; agentId: string; messageIndex: number };
  archive?: { path: string; at: string };
  reminderId?: string;
  scheduledTaskId?: string;
  scheduledRunId?: string;
}
export type ConversationSummary = Omit<
  Conversation,
  "messages" | "events" | "delegations"
> & {
  messageCount: number;
  preview: string;
};
export interface ConnectionStatus {
  login: boolean;
  planPermission: boolean;
  verified: boolean;
  detail: string;
}
export interface VaultToolArgs {
  offset?: number;
  lineOffset?: number;
  mode?: "path" | "content" | "both";
  date?: string;
  status?: "open" | "done" | "all";
  category?: "work" | "all";
  path?: string;
  query?: string;
  content?: string;
  expectedVersion?: string;
  destination?: string;
  limit?: number;
}
export interface VaultToolCall {
  capability: string;
  name: string;
  args: VaultToolArgs;
}
export interface JournalEntry {
  id: string;
  at: string;
  agentId: string;
  taskId: string;
  operation: "create" | "write" | "rename" | "trash" | "restore";
  path: string;
  destination?: string;
  before: string | null;
  after: string | null;
  beforeVersion: string;
  afterVersion: string;
  status: "pending" | "applied" | "failed";
  error?: string;
}
export interface RunnerInit {
  vaultRoot?: string;
  dataDir: string;
  vaultId: string;
  agents: AgentRecord[];
  settings: PluginSettings;
}
export const VIEW_TYPE = "pi-agent-chat";
export const isoNow = () => new Date().toISOString();
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
