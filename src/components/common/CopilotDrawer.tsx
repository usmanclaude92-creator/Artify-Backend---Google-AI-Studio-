/**
 * Reusable Copilot Drawer Component
 * Embeddable anywhere in Artify modules to provide contextual AI assistance.
 */
import React, { useState } from "react";
import { Bot, X, Sparkles, Send, Coins } from "lucide-react";
import { Button } from "../ui/ui";
import { copilotApi, type CopilotMessage, type CopilotActionPreview } from "../../lib/api";
import { useToast } from "../../context/ToastContext";

export interface CopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  contextModule: string;
  contextMetadata?: Record<string, unknown>;
  initialPrompt?: string;
}

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({
  isOpen,
  onClose,
  contextModule,
  contextMetadata,
  initialPrompt,
}) => {
  const { notify } = useToast();
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [inputContent, setInputContent] = useState(initialPrompt || "");
  const [isSending, setIsSending] = useState(false);
  const [actionPreview, setActionPreview] = useState<CopilotActionPreview | null>(null);

  if (!isOpen) return null;

  const handleSend = async () => {
    if (!inputContent.trim() || isSending) return;
    const prompt = inputContent.trim();
    setInputContent("");
    setIsSending(true);

    const tempMsg: CopilotMessage = {
      id: `temp-${Date.now()}`,
      conversationId: conversationId || "temp",
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
    setMessages((prev) => [...prev, tempMsg]);

    try {
      const res = await copilotApi.sendMessage({
        conversationId: conversationId || undefined,
        content: prompt,
        contextMetadata: {
          currentModule: contextModule,
          ...(contextMetadata || {}),
        },
      });

      setConversationId(res.data.conversationId);
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempMsg.id),
        res.data.userMessage,
        res.data.assistantMessage,
      ]);

      if (res.data.actionPreview) {
        setActionPreview(res.data.actionPreview);
      }
    } catch (err: any) {
      notify("error", `Copilot failed: ${err.message}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white dark:bg-neutral-900 border-l shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-indigo-600">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-neutral-900 dark:text-white">Artify Copilot</h3>
            <p className="text-[10px] text-neutral-500">Context: {contextModule}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
        {messages.length === 0 ? (
          <div className="text-center py-10 text-neutral-400">
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">How can I assist with this {contextModule} record?</p>
            <p className="text-[11px] mt-1">Ask questions, request summaries, or draft tasks.</p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}

        {actionPreview && (
          <div className="border border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-2.5 text-[11px]">
            <span className="font-bold text-amber-700 dark:text-amber-400 block mb-1">
              Action Preview: {actionPreview.actionType}
            </span>
            <p>{actionPreview.changesSummary}</p>
          </div>
        )}

        {isSending && (
          <div className="text-[11px] text-indigo-500 flex items-center gap-1.5 animate-pulse">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Analyzing...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={inputContent}
            onChange={(e) => setInputContent(e.target.value)}
            placeholder={`Ask about ${contextModule}...`}
            className="flex-1 text-xs border rounded-lg px-2.5 py-1.5 dark:bg-neutral-800 focus:outline-none"
          />
          <Button type="submit" variant="primary" size="sm" disabled={isSending}>
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
};
