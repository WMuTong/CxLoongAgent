import { useEffect, useState } from "react";
import { complete_human_request, fetch_human_request } from "../api";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  Textarea,
} from "../components/ui";
import type { HumanRequestDetail, HumanRequestSummary } from "../types";
import { to_error_message } from "./format";

type HumanRequestDialogProps = {
  request: HumanRequestSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

export function HumanRequestDialog({
  request,
  open,
  onOpenChange,
  onChanged,
}: HumanRequestDialogProps) {
  const [detail, setDetail] = useState<HumanRequestDetail | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!request || !open) return;
    setDetail(null);
    setResult("");
    setError(null);
    fetch_human_request(request.agent_path, request.relative_path)
      .then(setDetail)
      .catch((load_error) => setError(to_error_message(load_error)));
  }, [request, open]);

  const submit = async () => {
    if (!request) return;
    setSubmitting(true);
    setError(null);
    try {
      await complete_human_request({
        agent_path: request.agent_path,
        request_path: request.relative_path,
        result,
      });
      onChanged();
    } catch (submit_error) {
      setError(to_error_message(submit_error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(980px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{request?.summary ?? "人工介入请求"}</DialogTitle>
          <DialogDescription>{request?.relative_path}</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert className="border-red-200 bg-red-50 text-red-900">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="dialog-grid">
          <ScrollArea className="max-h-[58vh] rounded-lg border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap text-sm leading-6">
              {detail?.content ?? "读取中"}
            </pre>
          </ScrollArea>
          <div className="flex min-h-0 flex-col gap-3">
            <div className="min-h-0 flex-1">
              <div className="mb-2 text-sm font-medium">人类处理结果</div>
              <Textarea
                className="min-h-[220px]"
                value={result}
                placeholder="填写处理结果，提交后请求会标记为 done。"
                disabled={detail?.status !== "waiting"}
                onChange={(event) => setResult(event.target.value)}
              />
            </div>
            <Button
              disabled={!result.trim() || submitting || detail?.status !== "waiting"}
              onClick={submit}
            >
              {submitting ? "提交中" : "标记完成"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
