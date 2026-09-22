import { useRef, useState } from "react";
import { FileUp } from "lucide-react";

export default function ImportDropzone({
  onFile,
  disabled,
  compact,
  manual = false,
}: {
  onFile: (file: File | undefined) => void;
  disabled?: boolean;
  compact?: boolean;
  manual?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className="ki-dropzone"
      data-dragging={dragging}
      data-compact={compact}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) onFile(event.dataTransfer.files[0]);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <FileUp size={compact ? 18 : 28} strokeWidth={1.5} />
        <span>
          {compact ? "拖入文件，或点击重新选择" : "拖入文档，或点击选择文件"}
          <small>
            {manual ? "JSON、Markdown、TXT" : "Markdown、TXT"} · 最大 8 MB
          </small>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="拖放区域文件选择"
        accept={manual ? ".json,.md,.markdown,.txt" : ".md,.markdown,.txt"}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
