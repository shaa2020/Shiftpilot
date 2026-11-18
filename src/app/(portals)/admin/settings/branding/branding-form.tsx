"use client";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/forms/submit-button";
import { BrandMark } from "@/components/layout/brand";
import { readableOn } from "@/lib/branding-css";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/lib/actions/state";
import { saveBrandingAction } from "./actions";

const PRESETS = ["#2563eb", "#0f766e", "#7c3aed", "#db2777", "#ea580c", "#16a34a", "#0891b2", "#1e293b"];
const DEFAULT = "#2563eb";

export function BrandingForm({
  agencyName,
  initial,
}: {
  agencyName: string;
  initial: { brandColor: string | null; logoUrl: string | null; workerWelcome: string; clientWelcome: string; invoiceFooter: string };
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveBrandingAction, {});
  const [color, setColor] = useState(initial.brandColor ?? DEFAULT);
  const [preview, setPreview] = useState<string | null>(initial.logoUrl);
  const [removeLogo, setRemoveLogo] = useState(false);
  const e = state.errors ?? {};
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
  }, [state]);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  const fg = readableOn(color);

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_20rem]" noValidate>
      <div className="space-y-6">
        {state.message && !state.ok && <Alert tone="danger">{state.message}</Alert>}
        <Card>
          <CardHeader>
            <CardTitle>Logo and colour</CardTitle>
            <CardDescription>Use a square PNG or JPEG under 256 KB. The colour is used for buttons, links and highlights.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <FormField id="logo" label="Logo" error={e.logo}>
              <Input
                name="logo"
                type="file"
                accept="image/png,image/jpeg"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  if (f) { setPreview(URL.createObjectURL(f)); setRemoveLogo(false); }
                }}
              />
            </FormField>
            {initial.logoUrl && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="remove_logo" checked={removeLogo} onChange={(ev) => { setRemoveLogo(ev.target.checked); if (ev.target.checked) setPreview(null); else setPreview(initial.logoUrl); }} className="size-4 accent-primary" />
                Remove the current logo
              </label>
            )}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Brand colour</legend>
              <div className="flex flex-wrap items-center gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setColor(p)}
                    aria-label={`Use ${p}`}
                    aria-pressed={color === p}
                    className={cn("grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition", color === p && "ring-2 ring-foreground")}
                    style={{ background: p }}
                  >
                    {color === p && <Check className="size-4" style={{ color: readableOn(p) }} aria-hidden />}
                  </button>
                ))}
                <label className="flex items-center gap-2 rounded-full border border-border px-2 py-1 text-sm">
                  <input type="color" value={color} onChange={(ev) => setColor(ev.target.value)} className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label="Custom colour" />
                  <input
                    id="brand_color"
                    name="brand_color"
                    value={color}
                    onChange={(ev) => setColor(ev.target.value)}
                    className="w-20 bg-transparent font-mono text-xs outline-none"
                    aria-label="Colour code"
                    aria-invalid={!!e.brand_color}
                  />
                </label>
                {color !== DEFAULT && (
                  <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setColor(DEFAULT)}>Reset to default</button>
                )}
              </div>
              {e.brand_color && <p className="text-sm text-danger">{e.brand_color}</p>}
            </fieldset>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Welcome messages</CardTitle>
            <CardDescription>Shown at the top of the worker and client home screens. Leave empty to hide.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField id="worker_welcome" label="Message for workers" error={e.worker_welcome}>
              <Textarea name="worker_welcome" rows={3} maxLength={500} defaultValue={initial.workerWelcome} placeholder="Welcome to the team! Questions? Message us any time." />
            </FormField>
            <FormField id="client_welcome" label="Message for clients" error={e.client_welcome}>
              <Textarea name="client_welcome" rows={3} maxLength={500} defaultValue={initial.clientWelcome} placeholder="Thank you for working with us. Your account manager is available on weekdays 8:00–18:00." />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>A short line printed at the bottom of every invoice PDF, such as payment terms or a thank-you.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField id="invoice_footer" label="Invoice footer" error={e.invoice_footer}>
              <Input name="invoice_footer" maxLength={300} defaultValue={initial.invoiceFooter} placeholder="Our general terms apply. Thank you for your business." />
            </FormField>
          </CardContent>
        </Card>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Saving…">Save branding</SubmitButton>
        </div>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Preview">
        <Card className="overflow-hidden">
          <div className="sidebar-surface flex items-center gap-2 px-4 py-3 text-white">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Logo preview" className="size-8 rounded-md bg-white object-contain p-0.5" />
            ) : (
              <BrandMark />
            )}
            <span className="truncate font-semibold">{preview ? agencyName : "ShiftPilot"}</span>
          </div>
          <CardContent className="space-y-3 pt-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Preview</p>
            <div className="rounded-lg px-3 py-2 text-sm font-medium" style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}>
              Active menu item
            </div>
            <span className="inline-flex h-9 items-center rounded-md px-4 text-sm font-medium shadow-sm" style={{ background: color, color: fg }}>
              Primary button
            </span>
            <p className="text-sm">
              Text with a <span className="font-medium underline" style={{ color }}>link</span>.
            </p>
          </CardContent>
        </Card>
      </aside>
    </form>
  );
}
