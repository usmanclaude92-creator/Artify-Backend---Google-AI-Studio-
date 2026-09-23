/**
 * Phase 12 — AI Control Center Management Dashboard & Operations Console.
 * Real-time monitoring, provider configuration, agent lifecycle, prompt engineering,
 * tool governance, workflow orchestration, human approval gates, and telemetry.
 */
import React, { useEffect, useState, useMemo } from "react";
import {
  Sparkles,
  Cpu,
  Bot,
  Terminal,
  Wrench,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  Coins,
  Activity,
  Play,
  RotateCw,
  Plus,
  Search,
  Sliders,
  History,
  AlertTriangle,
  ArrowUpRight,
  ShieldAlert,
  Send,
  HelpCircle,
  FileCode2,
  Workflow,
  Zap,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import {
  aiApi,
  copilotApi,
  type AiDashboardStats,
  type CopilotDashboardStats,
  type AiProvider,
  type AiModel,
  type AiAgent,
  type AiPrompt,
  type AiTool,
  type AiWorkflow,
  type AiApproval,
  type AiExecution,
  type AiCapability,
} from "../../lib/api";
import { Card, Button, Input, Select, Badge, LoadingState, ErrorState, EmptyState, Modal, Field } from "../ui/ui";
import { hasPermission } from "../../lib/permissions";

type TabKey = "overview" | "copilot" | "providers" | "agents" | "prompts" | "tools" | "workflows" | "approvals" | "executions";

export const AiControlCenterPage: React.FC = () => {
  const { user } = useAuth();
  const { notify } = useToast();
  const permissions = user?.role.permissions;

  const canManage = hasPermission(permissions, "ai.manage") || hasPermission(permissions, "ai.admin");
  const canUse = hasPermission(permissions, "ai.use") || canManage;
  const canApprove = hasPermission(permissions, "ai.approve") || hasPermission(permissions, "ai.admin");

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [stats, setStats] = useState<AiDashboardStats | null>(null);
  const [capabilities, setCapabilities] = useState<AiCapability[]>([]);
  const [providers, setProviders] = useState<AiProvider[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [prompts, setPrompts] = useState<AiPrompt[]>([]);
  const [tools, setTools] = useState<AiTool[]>([]);
  const [workflows, setWorkflows] = useState<AiWorkflow[]>([]);
  const [approvals, setApprovals] = useState<AiApproval[]>([]);
  const [executions, setExecutions] = useState<AiExecution[]>([]);
  const [copilotStats, setCopilotStats] = useState<CopilotDashboardStats | null>(null);

  // Search & Filters
  const [searchFilter, setSearchFilter] = useState("");

  // Modals
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AiAgent | null>(null);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<AiPrompt | null>(null);
  const [toolTesterOpen, setToolTesterOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<AiTool | null>(null);
  const [toolArgsText, setToolArgsText] = useState("{}");
  const [toolTestResult, setToolTestResult] = useState<any>(null);
  const [executionDetailsOpen, setExecutionDetailsOpen] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<AiExecution | null>(null);

  // Approval Decision Dialog
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<AiApproval | null>(null);
  const [approvalDecision, setApprovalDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [approvalReason, setApprovalReason] = useState("");
  const [approving, setApproving] = useState(false);

  // Sandbox Runner State
  const [sandboxPrompt, setSandboxPrompt] = useState("Summarize enterprise client engagement performance for this quarter.");
  const [sandboxCapability, setSandboxCapability] = useState("SUMMARIZATION");
  const [sandboxAgentId, setSandboxAgentId] = useState<string>("");
  const [sandboxModelId, setSandboxModelId] = useState<string>("");
  const [sandboxTemp, setSandboxTemp] = useState<number>(0.3);
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<any>(null);

  // Load all initial data
  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        statsRes,
        capRes,
        provRes,
        modRes,
        agentRes,
        promptRes,
        toolsRes,
        wfRes,
        appRes,
        execRes,
      ] = await Promise.all([
        aiApi.dashboard(),
        aiApi.capabilities(),
        aiApi.listProviders(),
        aiApi.listModels(),
        aiApi.listAgents({ limit: 50 }),
        aiApi.listPrompts({ limit: 50 }),
        aiApi.listTools(),
        aiApi.listWorkflows({ limit: 50 }),
        aiApi.listApprovals({ limit: 50 }),
        aiApi.listExecutions({ limit: 50 }),
        copilotApi.getDashboard().catch(() => ({ data: null })),
      ]);

      setStats(statsRes.stats);
      setCapabilities(capRes.capabilities);
      setProviders(provRes.providers);
      setModels(modRes.models);
      setAgents(agentRes.items);
      setPrompts(promptRes.items);
      setTools(toolsRes.tools);
      setWorkflows(wfRes.items);
      setApprovals(appRes.items);
      setExecutions(execRes.items);
      if (copilotRes && (copilotRes as any).data) {
        setCopilotStats((copilotRes as any).data);
      }

      if (!sandboxAgentId && agentRes.items.length > 0) {
        setSandboxAgentId(agentRes.items[0].id);
      }
      if (!sandboxModelId && modRes.models.length > 0) {
        setSandboxModelId(modRes.models[0].id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load AI Control Center data.";
      setError(msg);
      notify(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // Provider Ping Test
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const handleTestProvider = async (providerId: string) => {
    setTestingProviderId(providerId);
    try {
      const res = await aiApi.testProvider(providerId);
      notify(`Connection verified: ${res.result.durationMs}ms latency response received.`, "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Provider test ping failed.";
      notify(msg, "error");
    } finally {
      setTestingProviderId(null);
    }
  };

  // Run Sandbox prompt
  const handleRunSandbox = async () => {
    if (!sandboxPrompt.trim()) return;
    setSandboxRunning(true);
    setSandboxResult(null);
    try {
      const res = await aiApi.execute({
        prompt: sandboxPrompt,
        capability: sandboxCapability,
        agentId: sandboxAgentId || undefined,
        modelId: sandboxModelId || undefined,
        temperature: sandboxTemp,
      });
      setSandboxResult(res.result);
      notify("AI execution completed successfully.", "success");
      // Refresh executions & stats in background
      aiApi.dashboard().then((d) => setStats(d.stats)).catch(() => {});
      aiApi.listExecutions({ limit: 50 }).then((e) => setExecutions(e.items)).catch(() => {});
      aiApi.listApprovals({ limit: 50 }).then((a) => setApprovals(a.items)).catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Execution failed.";
      notify(msg, "error");
    } finally {
      setSandboxRunning(false);
    }
  };

  // Run Tool Tester
  const handleRunTool = async () => {
    if (!selectedTool) return;
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(toolArgsText);
      } catch {
        notify("Invalid JSON arguments format", "error");
        return;
      }
      const res = await aiApi.executeTool(selectedTool.name, parsed);
      setToolTestResult(res.result);
      notify("Tool executed successfully.", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Tool test failed.";
      notify(msg, "error");
    }
  };

  // Handle Human Approval Decision
  const handleDecideApproval = async () => {
    if (!selectedApproval) return;
    setApproving(true);
    try {
      await aiApi.decideApproval(selectedApproval.id, approvalDecision, approvalReason);
      notify(`Approval gate ${approvalDecision.toLowerCase()} successfully.`, "success");
      setApprovalModalOpen(false);
      // Reload approvals & executions
      const [appRes, execRes, statsRes] = await Promise.all([
        aiApi.listApprovals({ limit: 50 }),
        aiApi.listExecutions({ limit: 50 }),
        aiApi.dashboard(),
      ]);
      setApprovals(appRes.items);
      setExecutions(execRes.items);
      setStats(statsRes.stats);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record approval decision.";
      notify(msg, "error");
    } finally {
      setApproving(false);
    }
  };

  if (loading) return <LoadingState label="Loading AI Control Center architecture..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(135deg, #6366f1 0%, #4338ca 100%)" }}>
              <Sparkles className="w-4 h-4" />
            </div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
              AI Control Center
            </h1>
            <Badge tone="success">Operational</Badge>
          </div>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Centralized orchestration, model governance, autonomous coworkers, tool sandboxing, and human authorization.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canUse && (
            <Button
              variant="primary"
              onClick={() => setSandboxOpen(true)}
              className="px-4 py-2 text-xs font-semibold shadow-sm"
            >
              <Terminal className="w-3.5 h-3.5" />
              Interactive Sandbox
            </Button>
          )}
          <Button variant="secondary" onClick={loadAll} aria-label="Refresh data">
            <RotateCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b overflow-x-auto text-xs font-semibold" style={{ borderColor: "var(--border)" }}>
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "overview" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Overview & Telemetry
        </button>
        <button
          onClick={() => setActiveTab("copilot")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "copilot" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Copilot Workspace ({copilotStats?.activeConversations ?? 0})
        </button>
        <button
          onClick={() => setActiveTab("providers")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "providers" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          Providers & Models ({providers.length})
        </button>
        <button
          onClick={() => setActiveTab("agents")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "agents" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          Agents & Coworkers ({agents.length})
        </button>
        <button
          onClick={() => setActiveTab("prompts")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "prompts" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5" />
          Prompts & Templates ({prompts.length})
        </button>
        <button
          onClick={() => setActiveTab("tools")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "tools" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Wrench className="w-3.5 h-3.5" />
          Tool Registry ({tools.length})
        </button>
        <button
          onClick={() => setActiveTab("workflows")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "workflows" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Workflow className="w-3.5 h-3.5" />
          Workflows ({workflows.length})
        </button>
        <button
          onClick={() => setActiveTab("approvals")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "approvals" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          Approval Queue ({approvals.filter((a) => a.status === "PENDING").length})
        </button>
        <button
          onClick={() => setActiveTab("executions")}
          className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition whitespace-nowrap ${
            activeTab === "executions" ? "border-indigo-600 text-indigo-600 font-bold" : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Execution Log ({executions.length})
        </button>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* TAB 1: OVERVIEW & TELEMETRY */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "overview" && stats && (
        <div className="space-y-6">
          {/* KPI Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>Total Executions</span>
                <Sparkles className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="text-2xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {stats.totalExecutions}
              </div>
              <div className="flex items-center gap-1.5 mt-1 text-[11px] text-emerald-600">
                <CheckCircle2 className="w-3 h-3" />
                <span>{stats.successRate}% success rate</span>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>Token Volume</span>
                <Coins className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {stats.totalTokens.toLocaleString()}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                In: {stats.inputTokens.toLocaleString()} | Out: {stats.outputTokens.toLocaleString()}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>Estimated Cost</span>
                <Coins className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                ${stats.estimatedCost.toFixed(4)}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                Avg duration: {stats.averageDurationMs}ms
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                <span>Human Approval Queue</span>
                <ShieldAlert className="w-4 h-4 text-rose-500" />
              </div>
              <div className="text-2xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {stats.pendingApprovals}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                {stats.activeAgents} active coworkers
              </div>
            </Card>
          </div>

          {/* Capability Grid */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  Enterprise AI Capabilities
                </h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  13 platform-supported capabilities available to agents and workflows.
                </p>
              </div>
              <Badge tone="info">{capabilities.length} Capabilities</Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {capabilities.map((cap) => {
                const count = stats.breakdownByCapability[cap.id] || 0;
                return (
                  <div
                    key={cap.id}
                    className="p-3 rounded-xl border flex flex-col justify-between space-y-2"
                    style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                          {cap.name}
                        </span>
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          {cap.category}
                        </span>
                      </div>
                      <p className="text-[11px] mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                        {cap.description}
                      </p>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t text-[10px]" style={{ borderColor: "var(--border)" }}>
                      <span style={{ color: "var(--text-muted)" }}>
                        Model: {cap.recommendedModelType}
                      </span>
                      <span className="font-semibold text-indigo-600">
                        {count} {count === 1 ? "run" : "runs"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Recent Executions Stream */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                  Recent Agent Executions
                </h3>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Live Telemetry
                </span>
              </div>
              <div className="divide-y text-xs" style={{ borderColor: "var(--border)" }}>
                {stats.recentExecutions.length === 0 ? (
                  <div className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                    No execution events recorded yet.
                  </div>
                ) : (
                  stats.recentExecutions.slice(0, 5).map((ex) => (
                    <div key={ex.id} className="py-2.5 flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {ex.agent?.name || "Direct Prompt Execution"}
                          </span>
                          <Badge tone={ex.status === "COMPLETED" ? "success" : ex.status === "FAILED" ? "danger" : "warning"}>
                            {ex.status}
                          </Badge>
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {ex.capability} • {ex.totalTokens} tokens • {ex.durationMs}ms
                        </div>
                      </div>
                      <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                        {new Date(ex.startedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-rose-600 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Execution Failure Diagnostics
                </h3>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  Audit Trail
                </span>
              </div>
              <div className="divide-y text-xs" style={{ borderColor: "var(--border)" }}>
                {stats.recentFailures.length === 0 ? (
                  <div className="py-6 text-center text-xs text-emerald-600 flex flex-col items-center gap-1">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Zero execution failures recorded. Operational health 100%.</span>
                  </div>
                ) : (
                  stats.recentFailures.map((ex) => (
                    <div key={ex.id} className="py-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-rose-600">{ex.capability}</span>
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                          {new Date(ex.startedAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono bg-rose-50 dark:bg-rose-950/30 p-1.5 rounded border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300">
                        {ex.errorMessage || "Unknown invocation error"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB: COPILOT WORKSPACE MANAGEMENT & ANALYTICS */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "copilot" && (
        <div className="space-y-6">
          {/* KPI Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Active Conversations</span>
                <MessageSquare className="w-4 h-4 text-indigo-600" />
              </div>
              <div className="text-2xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {copilotStats?.activeConversations ?? 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {copilotStats?.totalMessages ?? 0} total messages
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Copilot Requests</span>
                <Bot className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {copilotStats?.totalRequests ?? 0}
              </div>
              <div className="text-[11px] text-emerald-600 mt-1">
                {copilotStats?.successfulRequests ?? 0} completed successfully
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Pending Action Approvals</span>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-bold mt-2 text-amber-600">
                {copilotStats?.pendingActions ?? 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {copilotStats?.executedActions ?? 0} actions executed
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Tokens & Cost</span>
                <Coins className="w-4 h-4 text-violet-600" />
              </div>
              <div className="text-2xl font-bold mt-2" style={{ color: "var(--text-primary)" }}>
                {copilotStats?.totalTokens ? `${(copilotStats.totalTokens / 1000).toFixed(1)}k` : "0k"}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Est. ${copilotStats?.estimatedCost?.toFixed(4) ?? "0.0000"} USD
              </div>
            </Card>
          </div>

          {/* Workspaces & Quick Launch */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  Enterprise Copilot Workspaces
                </h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Domain-specific AI copilots with RBAC scoping, grounding rules, and tool access limits.
                </p>
              </div>
              <a
                href="/copilot"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition"
              >
                <span>Launch Copilot Workspace</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
              {copilotStats?.mostUsedWorkspaces?.map((ws) => (
                <div
                  key={ws.id}
                  className="p-3.5 rounded-xl border flex items-center justify-between transition hover:border-indigo-300 dark:hover:border-indigo-800"
                  style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        {ws.name}
                      </h4>
                      <span className="text-[10px] text-slate-400 font-mono">/{ws.slug}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-indigo-600">
                      {ws.conversationsCount}
                    </span>
                    <span className="text-[10px] text-slate-400 block">chats</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 2: PROVIDERS & MODELS */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "providers" && (
        <div className="space-y-6">
          {/* Providers List */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  Registered AI Providers
                </h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Underlying model hosting infrastructure, base URLs, and securely isolated server-side credentials.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="p-4 rounded-xl border flex flex-col justify-between space-y-3"
                  style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-indigo-600" />
                        <span className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {p.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.isDefault && <Badge tone="info">Default</Badge>}
                        <Badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>{p.status}</Badge>
                      </div>
                    </div>

                    <div className="text-xs space-y-1 font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                      <div>Type: {p.providerType}</div>
                      <div>Endpoint: {p.baseUrl || "Default Provider Endpoint"}</div>
                      <div>Secret Ref: {p.credentialRef || "ENV Managed (Hidden from browser)"}</div>
                    </div>

                    <div className="flex flex-wrap gap-1 pt-1">
                      {p.supportedCapabilities.slice(0, 5).map((c) => (
                        <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {c}
                        </span>
                      ))}
                      {p.supportedCapabilities.length > 5 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-500">
                          +{p.supportedCapabilities.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {(p.models || []).length} associated models
                    </span>
                    {canManage && (
                      <Button
                        variant="secondary"
                        disabled={testingProviderId === p.id}
                        onClick={() => handleTestProvider(p.id)}
                        className="text-xs px-2.5 py-1"
                      >
                        <Zap className="w-3 h-3 text-amber-500" />
                        {testingProviderId === p.id ? "Pinging..." : "Test Connection"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Models Catalog Table */}
          <Card className="p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                AI Model Catalog
              </h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Verified foundation models with defined context limits, pricing tokens, and capability flags.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    <th className="py-2.5 px-3 font-semibold">Model Name</th>
                    <th className="py-2.5 px-3 font-semibold">Type</th>
                    <th className="py-2.5 px-3 font-semibold">Context Limit</th>
                    <th className="py-2.5 px-3 font-semibold">Features</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Default</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {models.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-500/5">
                      <td className="py-3 px-3">
                        <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
                          {m.displayName}
                        </div>
                        <div className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {m.modelName}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="font-mono text-[10px]">{m.modelType}</span>
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {(m.contextLimit / 1024).toFixed(0)}k tokens
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex gap-1 flex-wrap">
                          {m.supportsTools && <Badge tone="info">Tools</Badge>}
                          {m.supportsVision && <Badge tone="neutral">Vision</Badge>}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status}</Badge>
                      </td>
                      <td className="py-3 px-3">
                        {m.isDefault && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 3: AGENTS & COWORKERS */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "agents" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Autonomous AI Agents (Coworkers)
              </h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Purpose-scoped enterprise agents with specialized instructions, tool permissions, and human guardrails.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {agents.map((agent) => (
              <Card key={agent.id} className="p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-indigo-600" />
                        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {agent.name}
                        </h3>
                      </div>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {agent.description || agent.purpose}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={agent.status === "ACTIVE" ? "success" : "neutral"}>
                        {agent.status}
                      </Badge>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        v{agent.version}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border text-xs font-mono space-y-1 text-[11px]" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      System Instructions
                    </div>
                    <div className="line-clamp-3" style={{ color: "var(--text-secondary)" }}>
                      {agent.systemInstructions}
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Target Model:</span>
                      <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                        {agent.model?.displayName || "Default Foundation Model"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Human Gate Approval:</span>
                      {agent.requireApproval ? (
                        <Badge tone="warning">Required</Badge>
                      ) : (
                        <Badge tone="success">Autonomous</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Allowed Tools:</span>
                      <span className="font-mono text-[11px]" style={{ color: "var(--text-primary)" }}>
                        {agent.allowedTools.length === 0 ? "None" : agent.allowedTools.join(", ")}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSandboxAgentId(agent.id);
                      setSandboxOpen(true);
                    }}
                    className="text-xs px-3 py-1.5"
                  >
                    <Play className="w-3 h-3" />
                    Test in Sandbox
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 4: PROMPTS & TEMPLATES */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "prompts" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Prompt Template Library
              </h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Version-controlled, variable-interpolated prompt engineering blueprints for repeatable business tasks.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {prompts.map((p) => (
              <Card key={p.id} className="p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <FileCode2 className="w-4 h-4 text-indigo-600" />
                        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {p.name}
                        </h3>
                      </div>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {p.description || "Executive business prompt template"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge tone="info">{p.category}</Badge>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        v{p.version}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border text-xs font-mono space-y-1.5 text-[11px]" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Template Blueprint
                    </div>
                    <div className="text-indigo-600 dark:text-indigo-400 font-semibold line-clamp-3">
                      {p.template}
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <span style={{ color: "var(--text-muted)" }}>Hydration Variables:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {p.variables.map((v) => (
                        <span key={v} className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSandboxPrompt(p.template);
                      setSandboxOpen(true);
                    }}
                    className="text-xs px-3 py-1.5"
                  >
                    <Play className="w-3 h-3 text-indigo-600" />
                    Load in Sandbox
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 5: TOOL REGISTRY */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "tools" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Registered Tool Registry
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Strictly permission-gated functions that agents can formulate arguments for. AI can never execute arbitrary SQL or shell commands.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tools.map((t) => (
              <Card key={t.name} className="p-4 flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Wrench className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                        {t.displayName}
                      </span>
                    </div>
                    <Badge tone={t.riskLevel === "LOW" ? "success" : t.riskLevel === "MEDIUM" ? "warning" : "danger"}>
                      {t.riskLevel} Risk
                    </Badge>
                  </div>

                  <p className="text-xs line-clamp-2" style={{ color: "var(--text-muted)" }}>
                    {t.description}
                  </p>

                  <div className="space-y-1 text-[11px] pt-1 border-t" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Permission:</span>
                      <span className="font-mono font-semibold" style={{ color: "var(--text-primary)" }}>
                        {t.requiredPermission}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span style={{ color: "var(--text-muted)" }}>Approval Gate:</span>
                      {t.requiresApproval ? (
                        <Badge tone="warning">Required</Badge>
                      ) : (
                        <span className="text-slate-500 font-semibold">Autonomous</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t flex justify-end" style={{ borderColor: "var(--border)" }}>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSelectedTool(t);
                      setToolArgsText(
                        t.name === "searchClients"
                          ? '{"query": "Apex"}'
                          : t.name === "readInvoices"
                          ? '{"clientId": "client-01"}'
                          : t.name === "searchUsers"
                          ? '{"query": "Admin"}'
                          : "{}"
                      );
                      setToolTestResult(null);
                      setToolTesterOpen(true);
                    }}
                    className="text-xs px-2.5 py-1"
                  >
                    <Play className="w-3 h-3 text-indigo-600" />
                    Test Tool
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 6: WORKFLOW PIPELINES */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "workflows" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Autonomous Multi-Step Workflows
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Multi-step cognitive pipelines chaining extraction, tool lookups, and agent drafting.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {workflows.map((wf) => (
              <Card key={wf.id} className="p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Workflow className="w-4 h-4 text-indigo-600" />
                        <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                          {wf.name}
                        </h3>
                      </div>
                      <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {wf.description}
                      </p>
                    </div>
                    <Badge tone="success">{wf.status}</Badge>
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Pipeline Stages ({(wf.steps || []).length} steps)
                    </div>
                    <div className="space-y-1.5">
                      {(wf.steps || []).map((st: any, idx: number) => (
                        <div
                          key={idx}
                          className="p-2 rounded-lg border flex items-center justify-between text-xs"
                          style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}
                        >
                          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            Step {idx + 1}: {st.name || st.tool || st.capability}
                          </span>
                          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                            {st.tool ? "TOOL" : st.capability || "AGENT"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Trigger: {wf.trigger}
                  </span>
                  <Button
                    variant="primary"
                    onClick={async () => {
                      try {
                        const res = await aiApi.executeWorkflow(wf.id, { companyName: "Horizon Ventures" });
                        notify(`Workflow completed ${(res.result as any)?.completedSteps ?? "pipeline"} steps successfully.`, "success");
                        loadAll();
                      } catch (err: unknown) {
                        const msg = err instanceof Error ? err.message : "Workflow execution failed.";
                        notify(msg, "error");
                      }
                    }}
                    className="text-xs px-3 py-1.5"
                  >
                    <Play className="w-3 h-3" />
                    Run Pipeline
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 7: HUMAN APPROVAL QUEUE */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "approvals" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Human Authorization & Approval Gates
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Autonomous actions requiring designated review before state modification or publication.
            </p>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    <th className="py-2.5 px-3 font-semibold">Action Requested</th>
                    <th className="py-2.5 px-3 font-semibold">Requester</th>
                    <th className="py-2.5 px-3 font-semibold">Payload Preview</th>
                    <th className="py-2.5 px-3 font-semibold">Requested At</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {approvals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                        No pending authorization requests. All autonomous tasks cleared.
                      </td>
                    </tr>
                  ) : (
                    approvals.map((app) => (
                      <tr key={app.id} className="hover:bg-slate-500/5">
                        <td className="py-3 px-3">
                          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {app.action}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          {app.requesterId}
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-mono text-[10px] text-slate-500 line-clamp-1 max-w-xs">
                            {JSON.stringify(app.payload)}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {new Date(app.requestedAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-3">
                          <Badge tone={app.status === "PENDING" ? "warning" : app.status === "APPROVED" ? "success" : "danger"}>
                            {app.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {app.status === "PENDING" && canApprove ? (
                            <Button
                              variant="primary"
                              onClick={() => {
                                setSelectedApproval(app);
                                setApprovalDecision("APPROVED");
                                setApprovalReason("");
                                setApprovalModalOpen(true);
                              }}
                              className="text-xs px-2.5 py-1"
                            >
                              Review & Decide
                            </Button>
                          ) : (
                            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                              {app.decisionReason || "Resolved"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 8: EXECUTION LOG & TELEMETRY */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === "executions" && (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Unified AI Execution Audit Log
            </h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Comprehensive execution ledger capturing capability, latency, tokens, cost, and initiator.
            </p>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                    <th className="py-2.5 px-3 font-semibold">Execution ID</th>
                    <th className="py-2.5 px-3 font-semibold">Agent / Capability</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Tokens</th>
                    <th className="py-2.5 px-3 font-semibold">Duration</th>
                    <th className="py-2.5 px-3 font-semibold">Cost</th>
                    <th className="py-2.5 px-3 font-semibold">Started</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {executions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                        No execution events logged yet.
                      </td>
                    </tr>
                  ) : (
                    executions.map((ex) => (
                      <tr key={ex.id} className="hover:bg-slate-500/5">
                        <td className="py-3 px-3 font-mono text-[10px] text-indigo-600">
                          {ex.id.slice(0, 14)}...
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-semibold" style={{ color: "var(--text-primary)" }}>
                            {ex.agent?.name || "Direct Orchestrator Call"}
                          </div>
                          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {ex.capability}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge tone={ex.status === "COMPLETED" ? "success" : ex.status === "FAILED" ? "danger" : "warning"}>
                            {ex.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          {ex.totalTokens.toLocaleString()}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          {ex.durationMs ? `${ex.durationMs}ms` : "-"}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px] text-emerald-600">
                          ${ex.estimatedCost.toFixed(5)}
                        </td>
                        <td className="py-3 px-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {new Date(ex.startedAt).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <Button
                            variant="secondary"
                            onClick={() => {
                              setSelectedExecution(ex);
                              setExecutionDetailsOpen(true);
                            }}
                            className="text-xs px-2 py-1"
                          >
                            Details
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL: INTERACTIVE SANDBOX */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        open={sandboxOpen}
        onClose={() => setSandboxOpen(false)}
        title="Interactive AI Orchestration Sandbox"
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Execute prompts directly across models, agents, and capability pipelines with real-time telemetry.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Target Coworker / Agent">
              <Select
                value={sandboxAgentId}
                onChange={(e) => setSandboxAgentId(e.target.value)}
                className="w-full text-xs"
              >
                <option value="">Direct Orchestrator Prompt (No Agent)</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (v{a.version})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="AI Capability">
              <Select
                value={sandboxCapability}
                onChange={(e) => setSandboxCapability(e.target.value)}
                className="w-full text-xs"
              >
                {capabilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Prompt / Input Message">
            <textarea
              rows={4}
              value={sandboxPrompt}
              onChange={(e) => setSandboxPrompt(e.target.value)}
              className="w-full p-2.5 rounded-lg border text-xs focus:outline-none"
              style={{ background: "var(--bg-app)", borderColor: "var(--border)", color: "var(--text-primary)" }}
              placeholder="Type prompt or instructions..."
            />
          </Field>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span>Temperature: {sandboxTemp}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={sandboxTemp}
                onChange={(e) => setSandboxTemp(parseFloat(e.target.value))}
                className="w-24 accent-indigo-600"
              />
            </div>

            <Button
              variant="primary"
              disabled={sandboxRunning || !sandboxPrompt.trim()}
              onClick={handleRunSandbox}
              className="px-4 py-2"
            >
              <Send className="w-3.5 h-3.5" />
              {sandboxRunning ? "Orchestrating..." : "Execute Pipeline"}
            </Button>
          </div>

          {sandboxResult && (
            <div className="p-4 rounded-xl border space-y-3" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between text-xs pb-2 border-b" style={{ borderColor: "var(--border)" }}>
                <span className="font-bold text-indigo-600">Synthesis Result</span>
                <div className="flex items-center gap-3 font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span>{sandboxResult.durationMs}ms</span>
                  <span>{sandboxResult.totalTokens} tokens</span>
                  <span>${sandboxResult.estimatedCost.toFixed(5)}</span>
                </div>
              </div>

              {sandboxResult.requiresApproval && (
                <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-600 text-xs font-semibold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Approval Gate Required: This action was queued in the human approval list.</span>
                </div>
              )}

              <div
                className="text-xs whitespace-pre-wrap leading-relaxed font-sans"
                style={{ color: "var(--text-primary)" }}
              >
                {sandboxResult.output}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* MODAL: TOOL TESTER */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        open={toolTesterOpen}
        onClose={() => setToolTesterOpen(false)}
        title={selectedTool ? `Test Tool: ${selectedTool.displayName}` : "Tool Tester"}
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {selectedTool && (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {selectedTool.description}
              </p>

              <div className="p-2 rounded border text-xs font-mono" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
                <div className="text-[10px] text-slate-500 font-bold uppercase">Required Permission:</div>
                <div className="font-semibold text-indigo-600">{selectedTool.requiredPermission}</div>
              </div>

              <Field label="Input JSON Arguments">
                <textarea
                  rows={4}
                  value={toolArgsText}
                  onChange={(e) => setToolArgsText(e.target.value)}
                  className="w-full p-2.5 rounded-lg border text-xs font-mono focus:outline-none"
                  style={{ background: "var(--bg-app)", borderColor: "var(--border)", color: "var(--text-primary)" }}
                />
              </Field>

              <div className="flex justify-end">
                <Button variant="primary" onClick={handleRunTool}>
                  <Play className="w-3.5 h-3.5" />
                  Execute Tool
                </Button>
              </div>

              {toolTestResult && (
                <div className="p-3 rounded-xl border space-y-2 font-mono text-xs" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
                  <div className="text-[10px] font-bold text-slate-500 uppercase">Execution Output:</div>
                  <pre className="overflow-x-auto text-[11px]" style={{ color: "var(--text-primary)" }}>
                    {JSON.stringify(toolTestResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* MODAL: DECIDE APPROVAL */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        open={approvalModalOpen}
        onClose={() => setApprovalModalOpen(false)}
        title="Human Authorization Gate Decision"
      >
        <div className="space-y-4">
          {selectedApproval && (
            <div className="space-y-3">
              <div className="p-3 rounded-xl border text-xs space-y-1.5" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
                <div><span className="font-bold">Action:</span> {selectedApproval.action}</div>
                <div><span className="font-bold">Requester ID:</span> {selectedApproval.requesterId}</div>
                <div className="font-mono text-[10px] text-slate-500 mt-1">
                  {JSON.stringify(selectedApproval.payload, null, 2)}
                </div>
              </div>

              <Field label="Authorization Decision">
                <Select
                  value={approvalDecision}
                  onChange={(e) => setApprovalDecision(e.target.value as any)}
                  className="w-full text-xs"
                >
                  <option value="APPROVED">Authorize (Grant Execution)</option>
                  <option value="REJECTED">Deny (Reject Action)</option>
                </Select>
              </Field>

              <Field label="Decision Reason / Audit Note">
                <Input
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  placeholder="Optional review feedback..."
                />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => setApprovalModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant={approvalDecision === "APPROVED" ? "primary" : "danger"}
                  disabled={approving}
                  onClick={handleDecideApproval}
                >
                  {approving ? "Submitting..." : `Confirm ${approvalDecision}`}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ------------------------------------------------------------------- */}
      {/* MODAL: EXECUTION DETAILS */}
      {/* ------------------------------------------------------------------- */}
      <Modal
        open={executionDetailsOpen}
        onClose={() => setExecutionDetailsOpen(false)}
        title="Execution Audit Details"
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {selectedExecution && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 p-3 rounded-xl border font-mono text-[11px]" style={{ background: "var(--bg-app)", borderColor: "var(--border)" }}>
                <div>Status: <Badge tone={selectedExecution.status === "COMPLETED" ? "success" : "danger"}>{selectedExecution.status}</Badge></div>
                <div>Capability: {selectedExecution.capability}</div>
                <div>Duration: {selectedExecution.durationMs}ms</div>
                <div>Tokens: {selectedExecution.totalTokens}</div>
                <div>Cost: ${selectedExecution.estimatedCost.toFixed(6)}</div>
                <div>Started: {new Date(selectedExecution.startedAt).toLocaleTimeString()}</div>
              </div>

              {selectedExecution.errorMessage && (
                <div className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-700 font-mono text-[11px]">
                  {selectedExecution.errorMessage}
                </div>
              )}

              <div className="space-y-1">
                <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">
                  Input Metadata
                </div>
                <pre className="p-2.5 rounded border text-[10px] font-mono overflow-x-auto" style={{ background: "var(--bg-app)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
                  {JSON.stringify(selectedExecution.inputMetadata, null, 2)}
                </pre>
              </div>

              <div className="space-y-1">
                <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500">
                  Output Metadata & Preview
                </div>
                <pre className="p-2.5 rounded border text-[10px] font-mono overflow-x-auto" style={{ background: "var(--bg-app)", borderColor: "var(--border)", color: "var(--text-primary)" }}>
                  {JSON.stringify(selectedExecution.outputMetadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default AiControlCenterPage;
