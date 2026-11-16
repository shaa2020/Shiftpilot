import { Field, CheckboxField } from "@/components/forms/field";
import { Input, NativeSelect } from "@/components/ui/input";
import type { Tables } from "@/lib/database.types";

export function ClientFields({ client, industries }: { client?: Partial<Tables<"clients">>; industries: { id: string; name: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field name="name" label="Client name" required><Input name="name" defaultValue={client?.name ?? ""} /></Field>
      <Field name="legal_name" label="Legal name"><Input name="legal_name" defaultValue={client?.legal_name ?? ""} /></Field>
      <Field name="kvk_number" label="KvK number"><Input name="kvk_number" inputMode="numeric" defaultValue={client?.kvk_number ?? ""} /></Field>
      <Field name="vat_number" label="VAT number"><Input name="vat_number" defaultValue={client?.vat_number ?? ""} placeholder="NL123456789B01" /></Field>
      <Field name="industry_id" label="Industry">
        <NativeSelect name="industry_id" defaultValue={client?.industry_id ?? ""}>
          <option value="">Not specified</option>
          {industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </NativeSelect>
      </Field>
      <Field name="status" label="Status">
        <NativeSelect name="status" defaultValue={client?.status === "archived" ? "on_hold" : (client?.status ?? "onboarding")}>
          <option value="onboarding">Onboarding</option>
          <option value="active">Active</option>
          <option value="on_hold">On hold</option>
        </NativeSelect>
      </Field>
      <Field name="billing_email" label="Billing email"><Input name="billing_email" type="email" defaultValue={client?.billing_email ?? ""} /></Field>
      <Field name="payment_term_days" label="Payment term (days)" hint="Leave empty to use the agency default.">
        <Input name="payment_term_days" type="number" min={0} max={180} defaultValue={client?.payment_term_days ?? ""} />
      </Field>
      <Field name="billing_address_line1" label="Billing address" className="sm:col-span-2"><Input name="billing_address_line1" defaultValue={client?.billing_address_line1 ?? ""} /></Field>
      <Field name="billing_postal_code" label="Postal code"><Input name="billing_postal_code" defaultValue={client?.billing_postal_code ?? ""} /></Field>
      <Field name="billing_city" label="City"><Input name="billing_city" defaultValue={client?.billing_city ?? ""} /></Field>
      <Field name="billing_country_code" label="Country (ISO code)"><Input name="billing_country_code" maxLength={2} defaultValue={client?.billing_country_code ?? "NL"} /></Field>
      <div className="flex items-end"><CheckboxField name="po_number_required" label="Purchase order number required on invoices" defaultChecked={client?.po_number_required ?? false} /></div>
    </div>
  );
}
