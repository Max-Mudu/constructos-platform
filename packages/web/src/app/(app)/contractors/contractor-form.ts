/**
 * Contractor edit helpers. Mirrors packages/api/src/routes/contractor.routes.ts:
 *   PATCH  /contractors/:id  WRITE_ROLES (company_admin, project_manager)
 *   DELETE /contractors/:id  WRITE_ROLES — soft delete (isActive = false)
 *   updateSchema: name 1..200; contactPerson/email/phone/registrationNumber/
 *   tradeSpecialization nullish (null clears); isActive boolean.
 * UI only — the API stays the authority; keep the roles equal, never wider.
 */
import type { Contractor, UserRole } from '@/lib/types';

export const CONTRACTOR_WRITE_ROLES: readonly UserRole[] = ['company_admin', 'project_manager'];

export const canManageContractors = (role: UserRole | null | undefined) =>
  !!role && CONTRACTOR_WRITE_ROLES.includes(role);

export interface ContractorFormValues {
  name:                string;
  contactPerson:       string;
  email:               string;
  phone:               string;
  registrationNumber:  string;
  tradeSpecialization: string;
  isActive:            boolean;
}

const OPTIONAL = ['contactPerson', 'email', 'phone', 'registrationNumber', 'tradeSpecialization'] as const;

export function contractorToForm(c: Contractor): ContractorFormValues {
  return {
    name:                c.name,
    contactPerson:       c.contactPerson ?? '',
    email:               c.email ?? '',
    phone:               c.phone ?? '',
    registrationNumber:  c.registrationNumber ?? '',
    tradeSpecialization: c.tradeSpecialization ?? '',
    isActive:            c.isActive,
  };
}

export type ContractorUpdatePayload = Partial<{
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  registrationNumber: string | null;
  tradeSpecialization: string | null;
  isActive: boolean;
}>;

/** Only changed fields; a cleared optional field is sent as null. */
export function contractorUpdatePayload(before: Contractor, form: ContractorFormValues): ContractorUpdatePayload {
  const prev = contractorToForm(before);
  const out: ContractorUpdatePayload = {};
  if (form.name.trim() !== prev.name) out.name = form.name.trim();
  for (const k of OPTIONAL) {
    const v = form[k].trim();
    if (v !== prev[k]) out[k] = v || null;
  }
  if (form.isActive !== prev.isActive) out.isActive = form.isActive;
  return out;
}

export function contractorFormErrors(form: ContractorFormValues): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!form.name.trim()) errors.name = ['Company name is required'];
  const email = form.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = ['Enter a valid email address'];
  return errors;
}
