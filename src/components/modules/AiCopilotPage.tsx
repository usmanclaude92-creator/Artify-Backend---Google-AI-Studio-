/**
 * Phase 15: AI Copilot & Conversational Workspace Frontend
 * Enterprise conversational assistant featuring workspace selection,
 * persistent history, citations popover, tool telemetry, action previews,
 * and contextual prompting.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  Send,
  Plus,
  Search,
  Archive,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Clock,
  Coins,
  Cpu,
  Sparkles,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  Wrench,
  Users,
  Receipt,
  Workflow,
  ShieldAlert,
  Sliders,
  Layers,
  HelpCircle,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { hasPermission } from "../../lib/permissions";
import {
  copilotApi,
  type CopilotWorkspace,
  type CopilotConversation,
  type CopilotMessage,
  type CopilotActionPreview,
  type CopilotCitation,
} from "../../lib/api";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Modal, Field } from "../ui/ui";

const WORKSPACE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Bot,
  Users,
  Receipt,
  Workflow,
  FileText,
  Search,
  ShieldAlert,
  Sparkles,
};

const PROMPT_SUGGESTIONS: Record<string, string[]> = {
  "general-assistant": [
    "What are our security compliance standards?",
    "Summarize open organizational tasks",
    "List recent enterprise activity",
    "Create a task: Review security protocol",
  ],
  "crm-assistant": [
    "Find all clients currently in ONBOARDING status",
    "Search clients with name matching 'Acme'",
    "Breakdown leads by status",
    "Create a task: Schedule follow-up with client",
  ],
  "billing-assistant": [
    "List overdue invoices requiring follow-up",
    "What is our total outstanding invoice balance?",
    "Generate a summary report for invoices",
    "Create a task: Send payment reminder to overdue accounts",
  ],
  "operations-assistant": [
    "Check recent workflow execution statuses",
    "How many automated tasks are pending?",
    "Show steps for active workflows",
    "List all background schedules",
  ],
  "cms-assistant": [
    "Draft a release announcement for our next version",
    "Review recent published blog posts",
    "Summarize product modules for marketing copy",
    "Outline an executive thought leadership article",
  ],
  "knowledge-assistant": [
    "Search documents for data retention policy",
    "What are our standard contract variation terms?",
    "Explain our customer onboarding SLA",
    "List indexed documents in our knowledge base",
  ],
  "admin-assistant": [
    "Generate an executive platform metrics report",
    "Audit recent automated actions and risk events",
    "Review user access and active role assignments",
    "Inspect workflow engine throughput",
  ],
};

export const AiCopilotPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const permissions = user?.role.permissions;
  const canManage = hasPermission(permissions, "copilot.manage") || hasPermission(permissions, "copilot.admin");

  // State
  const [workspaces, setWorkspaces] = useState<CopilotWorkspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<CopilotWorkspace | null>(null);
  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<CopilotConversation | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [actionPreviews, setActionPreviews] = useState<CopilotActionPreview[]>([]);

  // Input & UI
  const [inputContent, setInputContent] = useState("");
  const [selectedMode, setSelectedMode] = useState<string>("ANSWER");
  const [filterStatus, setFilterStatus] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [searchQuery, setSearchQuery] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingActionId, setConfirmingActionId] = useState<string | null>(null);

  // New Workspace Modal
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [newWsDescription, setNewWsDescription] = useState("");
  const [newWsInstruction, setNewWsInstruction] = useState("");
  const [newWsTemperature, setNewWsTemperature] = useState(0.7);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  // Initial load
  useEffect(() => {
    loadWorkspacesAndConversations();
  }, [filterStatus]);

  const loadWorkspacesAndConversations = async () => {
    try {
      setLoading(true);
      setError(null);

      const [wsRes, convRes] = await Promise.all([
        copilotApi.listWorkspaces(),
        copilotApi.listConversations({ status: filterStatus, limit: 30 }),
      ]);

      const wsList = wsRes.data || [];
      setWorkspaces(wsList);

      if (!selectedWorkspace && wsList.length > 0) {
        const def = wsList.find((w) => w.isDefault) || wsList[0];
        setSelectedWorkspace(def);
        setSelectedMode(def.defaultMode || "ANSWER");
      }

      const convList = convRes.conversations || [];
      setConversations(convList);

      // Select first conversation if none selected
      if (!activeConversation && convList.length > 0) {
        selectConversation(convList[0].id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load Copilot workspaces.");
    } finally {
      setLoading(false);
    }
  };

  const selectConversation = async (conversationId: string) => {
    try {
      const res = await copilotApi.getConversation(conversationId);
      const conv = res.data;
      setActiveConversation(conv);
      setMessages(conv.messages || []);
      setActionPreviews(conv.actionPreviews || []);

      if (conv.workspace) {
        setSelectedWorkspace(conv.workspace);
        setSelectedMode(conv.workspace.defaultMode || "ANSWER");
      }
    } catch (err: any) {
      notify("error", `Failed to load conversation: ${err.message}`);
    }
  };

  const handleStartNewChat = async (workspace?: CopilotWorkspace) => {
    const ws = workspace || selectedWorkspace;
    if (!ws) return;

    try {
      const res = await copilotApi.createConversation({
        workspaceId: ws.id,
        title: "New AI Conversation",
      });
      const newConv = res.data;
      setConversations([newConv, ...conversations]);
      setActiveConversation(newConv);
      setMessages([]);
      setActionPreviews([]);
      setSelectedWorkspace(ws);
      setSelectedMode(ws.defaultMode || "ANSWER");
      notify("success", `Started conversation in ${ws.name}`);
    } catch (err: any) {
      notify("error", `Failed to create conversation: ${err.message}`);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const prompt = (textToSend || inputContent).trim();
    if (!prompt || isSending) return;

    setInputContent("");
    setIsSending(true);

    // Optimistically add user message
    const tempUserMsg: CopilotMessage = {
      id: `temp-${Date.now()}`,
      conversationId: activeConversation?.id || "temp",
      role: "user",
      content: prompt,
      status: "COMPLETED",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      estimatedCost: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const res = await copilotApi.sendMessage({
        conversationId: activeConversation?.id,
        workspaceId: selectedWorkspace?.id,
        content: prompt,
        mode: selectedMode,
      });

      const { conversationId, userMessage, assistantMessage, actionPreview } = res.data;

      // Replace optimistic message and append assistant message
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempUserMsg.id);
        return [...withoutTemp, userMessage, assistantMessage];
      });

      if (actionPreview) {
        setActionPreviews((prev) => [actionPreview, ...prev.filter((a) => a.id !== actionPreview.id)]);
      }

      // Update active conversation & list
      if (!activeConversation || activeConversation.id !== conversationId) {
        await selectConversation(conversationId);
        const convsRes = await copilotApi.listConversations({ status: filterStatus });
        setConversations(convsRes.conversations || []);
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessageAt: new Date().toISOString(), title: prompt.slice(0, 40) }
              : c
          )
        );
      }
    } catch (err: any) {
      notify("error", `Message failed: ${err.message}`);
      // Mark temporary message as failed
      setMessages((prev) =>
        prev.map((m) => (m.id === tempUserMsg.id ? { ...m, status: "FAILED" } : m))
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleConfirmAction = async (previewId: string) => {
    try {
      setConfirmingActionId(previewId);
      const res = await copilotApi.confirmAction(previewId);
      notify("success", "Action executed successfully!");

      // Update action preview status
      setActionPreviews((prev) =>
        prev.map((a) => (a.id === previewId ? { ...a, status: "EXECUTED", executionResult: res.data.result as any } : a))
      );

      // Reload conversation messages to show confirmation result
      if (activeConversation) {
        const refreshed = await copilotApi.getConversation(activeConversation.id);
        setMessages(refreshed.data.messages || []);
      }
    } catch (err: any) {
      notify("error", `Action failed: ${err.message}`);
    } finally {
      setConfirmingActionId(null);
    }
  };

  const handleRejectAction = async (previewId: string) => {
    try {
      await copilotApi.rejectAction(previewId);
      notify("info", "Action was cancelled.");
      setActionPreviews((prev) => prev.filter((a) => a.id !== previewId));

      if (activeConversation) {
        const refreshed = await copilotApi.getConversation(activeConversation.id);
        setMessages(refreshed.data.messages || []);
      }
    } catch (err: any) {
      notify("error", `Failed to cancel action: ${err.message}`);
    }
  };

  const handleArchiveConversation = async (convId: string) => {
    try {
      await copilotApi.archiveConversation(convId);
      notify("success", "Conversation archived.");
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversation?.id === convId) {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (err: any) {
      notify("error", `Archive failed: ${err.message}`);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    if (!window.confirm("Are you sure you want to delete this conversation permanently?")) return;
    try {
      await copilotApi.deleteConversation(convId);
      notify("success", "Conversation deleted.");
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversation?.id === convId) {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (err: any) {
      notify("error", `Delete failed: ${err.message}`);
    }
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;

    try {
      const res = await copilotApi.createWorkspace({
        name: newWsName.trim(),
        description: newWsDescription.trim(),
        systemInstruction: newWsInstruction.trim(),
        temperature: newWsTemperature,
        allowedTools: ["searchKnowledgeBase", "createTask", "generateNaturalLanguageReport"],
        requiredPermissions: ["copilot.use"],
      });
      notify("success", `Workspace "${res.data.name}" created!`);
      setShowWorkspaceModal(false);
      setNewWsName("");
      setNewWsDescription("");
      setNewWsInstruction("");
      loadWorkspacesAndConversations();
    } catch (err: any) {
      notify("error", `Failed to create workspace: ${err.message}`);
    }
  };

  const currentSuggestions = selectedWorkspace
    ? PROMPT_SUGGESTIONS[selectedWorkspace.slug] || PROMPT_SUGGESTIONS["general-assistant"]
    : [];

  const WorkspaceIcon = selectedWorkspace
    ? WORKSPACE_ICONS[selectedWorkspace.icon] || Bot
    : Bot;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-w-7xl mx-auto p-4 gap-4">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between border-b pb-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/50">
            <Sparkles className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
                Artify AI Copilot
              </h1>
              <Badge variant="info">Enterprise v15</Badge>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Grounded conversational assistant with verified RBAC, tool safety preview, and multi-workspace context.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWorkspaceModal(true)}
              className="flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Custom Workspace</span>
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => handleStartNewChat()}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </Button>
        </div>
      </div>

      {/* Main Layout: 3 Columns (Sidebar, Chat Feed, Context/Preview Drawer) */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 min-h-0">
        {/* Left Sidebar: Workspaces & Conversation History (3 cols) */}
        <div className="md:col-span-3 flex flex-col gap-3 min-h-0 bg-white dark:bg-neutral-900 border rounded-xl p-3 shadow-sm">
          {/* Workspace Selector */}
          <div>
            <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1 block">
              Active Workspace
            </label>
            <div className="relative">
              <select
                className="w-full text-xs font-medium bg-neutral-50 dark:bg-neutral-800 border rounded-lg p-2 pr-7 text-neutral-800 dark:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={selectedWorkspace?.id || ""}
                onChange={(e) => {
                  const ws = workspaces.find((w) => w.id === e.target.value);
                  if (ws) {
                    setSelectedWorkspace(ws);
                    setSelectedMode(ws.defaultMode || "ANSWER");
                    handleStartNewChat(ws);
                  }
                }}
              >
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name} {ws.isDefault ? "★" : ""}
                  </option>
                ))}
              </select>
            </div>
            {selectedWorkspace && (
              <p className="text-[11px] text-neutral-500 mt-1 line-clamp-2">
                {selectedWorkspace.description}
              </p>
            )}
          </div>

          <hr className="border-neutral-200 dark:border-neutral-800" />

          {/* Conversations Filter & Search */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-500">Conversations</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setFilterStatus("ACTIVE")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  filterStatus === "ACTIVE"
                    ? "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus("ARCHIVED")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  filterStatus === "ARCHIVED"
                    ? "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                }`}
              >
                Archived
              </button>
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-xs min-h-0">
            {conversations.length === 0 ? (
              <div className="py-8 text-center text-neutral-400">
                <MessageSquare className="w-6 h-6 mx-auto mb-1 opacity-50" />
                <p>No conversations found</p>
              </div>
            ) : (
              conversations.map((conv) => {
                const isActive = activeConversation?.id === conv.id;
                return (
                  <div
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`group flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                      isActive
                        ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-950 dark:text-indigo-100 border border-indigo-200 dark:border-indigo-900/60"
                        : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300"
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="font-medium truncate">{conv.title}</p>
                      <p className="text-[10px] text-neutral-400 truncate">
                        {new Date(conv.lastMessageAt).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>

                    <div className="hidden group-hover:flex items-center gap-1 opacity-80">
                      {conv.status === "ACTIVE" ? (
                        <button
                          type="button"
                          title="Archive chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleArchiveConversation(conv.id);
                          }}
                          className="p-1 hover:text-amber-600 rounded"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          title="Delete chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteConversation(conv.id);
                          }}
                          className="p-1 hover:text-red-600 rounded"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Center: Active Chat Stream (9 cols) */}
        <div className="md:col-span-9 flex flex-col min-h-0 bg-white dark:bg-neutral-900 border rounded-xl shadow-sm overflow-hidden">
          {/* Chat Header Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b bg-neutral-50/50 dark:bg-neutral-800/40">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
                <WorkspaceIcon className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">
                  {selectedWorkspace?.name || "General Assistant"}
                </h2>
                <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                  <span>Mode: {selectedMode}</span>
                  <span>•</span>
                  <span>Grounding: {selectedWorkspace?.requireCitations ? "Citations Active" : "Direct"}</span>
                </div>
              </div>
            </div>

            {/* Response Mode Selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-500 font-medium">Mode:</span>
              <select
                value={selectedMode}
                onChange={(e) => setSelectedMode(e.target.value)}
                className="text-xs border rounded-md px-2 py-1 bg-white dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 focus:outline-none"
              >
                <option value="ANSWER">Answer</option>
                <option value="EXPLAIN">Explain</option>
                <option value="SUMMARIZE">Summarize</option>
                <option value="ANALYZE">Analyze</option>
                <option value="RECOMMEND">Recommend</option>
                <option value="DRAFT">Draft</option>
                <option value="EXECUTE">Execute</option>
              </select>
            </div>
          </div>

          {/* Chat Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center max-w-lg mx-auto">
                <div className="p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 mb-3 border border-indigo-100 dark:border-indigo-900/50">
                  <WorkspaceIcon className="w-8 h-8" />
                </div>
                <h3 className="text-base font-semibold text-neutral-900 dark:text-white mb-1">
                  {selectedWorkspace?.name}
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-6">
                  {selectedWorkspace?.systemInstruction?.slice(0, 150) || "Ready to assist you with secure enterprise knowledge."}
                </p>

                {/* Suggestion Chips */}
                <div className="w-full flex flex-col gap-2">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider text-left">
                    Suggested Inquiries
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                    {currentSuggestions.map((sug, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSendMessage(sug)}
                        className="p-2.5 text-xs bg-neutral-50 hover:bg-indigo-50/70 dark:bg-neutral-800/70 dark:hover:bg-indigo-950/40 border border-neutral-200 dark:border-neutral-700/60 rounded-lg text-neutral-700 dark:text-neutral-300 transition text-left flex items-start justify-between gap-1 group"
                      >
                        <span>{sug}</span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition shrink-0 mt-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-2 mb-1 text-[11px] text-neutral-400 px-1">
                    <span className="font-semibold text-neutral-600 dark:text-neutral-300">
                      {msg.role === "user" ? "You" : selectedWorkspace?.name || "Copilot"}
                    </span>
                    <span>•</span>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {msg.role === "assistant" && msg.totalTokens > 0 && (
                      <span className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-[10px]">
                        <Coins className="w-2.5 h-2.5" />
                        {msg.totalTokens} tokens
                      </span>
                    )}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs leading-relaxed shadow-sm ${
                      msg.role === "user"
                        ? "bg-indigo-600 text-white rounded-br-none"
                        : "bg-neutral-50 dark:bg-neutral-800/90 text-neutral-900 dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-700/60 rounded-bl-none"
                    }`}
                  >
                    {/* Render content paragraphs */}
                    <div className="whitespace-pre-wrap space-y-2">
                      {msg.content}
                    </div>

                    {/* Citations Pill / Expandable */}
                    {msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-neutral-200 dark:border-neutral-700">
                        <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 block mb-1.5 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          Grounded Citations ({msg.citations.length})
                        </span>
                        <div className="space-y-1.5">
                          {msg.citations.map((c, idx) => (
                            <div
                              key={idx}
                              className="p-2 rounded bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-700/60 text-[11px]"
                            >
                              <div className="font-semibold text-neutral-800 dark:text-neutral-200 flex items-center justify-between">
                                <span>{c.documentTitle}</span>
                                {c.collectionName && (
                                  <Badge variant="outline" className="text-[9px] py-0">
                                    {c.collectionName}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2 italic">
                                "{c.snippet}"
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Tool Calls telemetric indicator */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-neutral-200 dark:border-neutral-700 flex flex-wrap gap-1.5">
                        {msg.toolCalls.map((tc, idx) => (
                          <div
                            key={idx}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-medium"
                          >
                            <Wrench className="w-2.5 h-2.5" />
                            Tool: {tc.tool} (Success)
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Action Previews Cards */}
            {actionPreviews.map((preview) => {
              const isExecuting = confirmingActionId === preview.id;
              const isPending = preview.status === "PENDING";
              return (
                <div
                  key={preview.id}
                  className={`border-2 rounded-xl p-4 my-3 text-xs ${
                    preview.status === "EXECUTED"
                      ? "border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10"
                      : preview.status === "REJECTED"
                      ? "border-neutral-300 bg-neutral-50 dark:bg-neutral-800/40"
                      : "border-amber-500/60 bg-amber-50/30 dark:bg-amber-950/20"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="font-bold text-neutral-900 dark:text-white uppercase tracking-wider text-[11px]">
                          Action Preview: {preview.actionType}
                        </span>
                        {preview.targetEntity && (
                          <p className="text-[11px] text-neutral-500">Target: {preview.targetEntity}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant={preview.status === "EXECUTED" ? "success" : preview.status === "REJECTED" ? "neutral" : "warning"}>
                      {preview.status}
                    </Badge>
                  </div>

                  <p className="font-medium text-neutral-800 dark:text-neutral-200 mb-2">
                    {preview.changesSummary}
                  </p>

                  {preview.reason && (
                    <p className="text-[11px] text-neutral-500 italic mb-3">
                      Reason: {preview.reason}
                    </p>
                  )}

                  {isPending && (
                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-amber-200 dark:border-amber-900/50">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRejectAction(preview.id)}
                        disabled={isExecuting}
                      >
                        Cancel Action
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleConfirmAction(preview.id)}
                        disabled={isExecuting}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                      >
                        {isExecuting ? "Executing..." : "Confirm & Execute"}
                      </Button>
                    </div>
                  )}

                  {preview.status === "EXECUTED" && preview.executionResult && (
                    <div className="mt-2 p-2 rounded bg-neutral-900 text-neutral-100 font-mono text-[10px] overflow-x-auto">
                      {JSON.stringify(preview.executionResult, null, 2)}
                    </div>
                  )}
                </div>
              );
            })}

            {isSending && (
              <div className="flex items-center gap-2 text-xs text-indigo-600 dark:text-indigo-400 p-2 animate-pulse">
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>Generating grounded response & verifying tool safety...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Message Input Box */}
          <div className="p-3 border-t bg-neutral-50/50 dark:bg-neutral-800/40">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-end gap-2"
            >
              <div className="flex-1 bg-white dark:bg-neutral-900 border rounded-xl p-2 shadow-sm focus-within:ring-1 focus-within:ring-indigo-500">
                <textarea
                  value={inputContent}
                  onChange={(e) => setInputContent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  rows={2}
                  placeholder={`Ask ${selectedWorkspace?.name || "Copilot"} anything... (Press Enter to send)`}
                  className="w-full text-xs bg-transparent border-0 resize-none focus:outline-none text-neutral-900 dark:text-white placeholder:text-neutral-400"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                disabled={!inputContent.trim() || isSending}
                className="h-10 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Custom Workspace Creation Modal */}
      {showWorkspaceModal && (
        <Modal
          isOpen={showWorkspaceModal}
          onClose={() => setShowWorkspaceModal(false)}
          title="Create Custom AI Workspace"
        >
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            <Field label="Workspace Name" required>
              <Input
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                placeholder="e.g. Legal Compliance Assistant"
                required
              />
            </Field>

            <Field label="Description">
              <Input
                value={newWsDescription}
                onChange={(e) => setNewWsDescription(e.target.value)}
                placeholder="Specialized assistant for contract review and terms validation"
              />
            </Field>

            <Field label="System Instruction">
              <textarea
                value={newWsInstruction}
                onChange={(e) => setNewWsInstruction(e.target.value)}
                rows={3}
                className="w-full text-xs border rounded-lg p-2 dark:bg-neutral-800"
                placeholder="You are an expert legal advisor for Artify Solutions..."
              />
            </Field>

            <Field label={`Creativity / Temperature (${newWsTemperature})`}>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={newWsTemperature}
                onChange={(e) => setNewWsTemperature(parseFloat(e.target.value))}
                className="w-full"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowWorkspaceModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Create Workspace
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
