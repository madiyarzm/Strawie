import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

interface SimpleInputModalProps {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export const SimpleInputModal: React.FC<SimpleInputModalProps> = ({
  title,
  placeholder = "",
  defaultValue = "",
  confirmLabel,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onConfirm(value.trim());
  };

  return (
    <div
      className="st-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="st-pop-in w-full max-w-sm rounded-[22px]"
        style={{ background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--text)", letterSpacing: "-0.01em" }}>{title}</h2>
          <button type="button" onClick={onCancel} className="st-icon-btn" aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 pb-5 pt-2 space-y-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="st-input w-full rounded-[12px] px-3.5 py-2.5 text-sm placeholder:opacity-50"
            required
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className="st-btn st-btn-ghost">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={!value.trim()} className="st-btn st-btn-primary">
              {confirmLabel ?? t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
