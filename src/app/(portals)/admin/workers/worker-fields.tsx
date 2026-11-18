import { Field } from "@/components/forms/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import type { Tables } from "@/lib/database.types";

export function WorkerFields({ worker, isNew }: { worker?: Partial<Tables<"workers">>; isNew?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field name="first_name" label="First name" required><Input name="first_name" defaultValue={worker?.first_name ?? ""} /></Field>
      <Field name="last_name" label="Last name" required><Input name="last_name" defaultValue={worker?.last_name ?? ""} /></Field>
      <Field name="display_name" label="Display name" hint="Shown to clients. Defaults to first name and last initial."><Input name="display_name" defaultValue={worker?.display_name ?? ""} /></Field>
      {isNew ? (
        <Field name="email" label="Email" required><Input name="email" type="email" defaultValue={worker?.email ?? ""} /></Field>
      ) : (
        <Field name="email_ro" label="Email" hint="The sign-in email cannot be changed here."><Input value={worker?.email ?? ""} readOnly disabled /></Field>
      )}
      <Field name="phone" label="Phone"><Input name="phone" type="tel" defaultValue={worker?.phone ?? ""} /></Field>
      {isNew && (
        <Field name="engagement_type" label="Engagement pathway" required hint="Employees work under an agency contract; freelancers must pass a classification review.">
          <NativeSelect name="engagement_type" defaultValue="employee">
            <option value="employee">Agency employee</option>
            <option value="freelancer">Independent freelancer</option>
          </NativeSelect>
        </Field>
      )}
      <Field name="city" label="City"><Input name="city" defaultValue={worker?.city ?? ""} /></Field>
      <Field name="postal_code" label="Postal code"><Input name="postal_code" defaultValue={worker?.postal_code ?? ""} /></Field>
      <Field name="max_travel_km" label="Maximum travel distance (km)"><Input name="max_travel_km" type="number" min={0} max={500} defaultValue={worker?.max_travel_km ?? ""} /></Field>
      <Field name="professional_summary" label="Professional summary" hint="Visible to clients for assigned shifts." className="sm:col-span-2">
        <Textarea name="professional_summary" rows={3} defaultValue={worker?.professional_summary ?? ""} />
      </Field>
    </div>
  );
}
