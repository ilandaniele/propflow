import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { listings, rentalApplications } from '@/lib/db/schema';
import type { RentalApplicationInput } from '@/lib/schemas/rental-application';
import { solvencyScore } from './scoring';

const APPLICATIONS_PAGE_SIZE = 100;

export type ApplicationDocument = { path: string; mime: string; name: string };
export type ApplicationStatus = typeof rentalApplications.$inferSelect['status'];

export async function rentListingBySlug(orgId: string, slug: string) {
  const [row] = await db
    .select({ id: listings.id, price: listings.price, title: listings.title })
    .from(listings)
    .where(and(
      eq(listings.orgId, orgId),
      eq(listings.publicSlug, slug),
      eq(listings.published, true),
      eq(listings.operation, 'rent'),
    ))
    .limit(1);
  return row ?? null;
}

export async function createRentalApplication(params: {
  id: string;
  orgId: string;
  input: RentalApplicationInput;
  listing: { id: string; price: string | null } | null;
  documents: ApplicationDocument[];
}): Promise<number> {
  const { id, orgId, input, listing, documents } = params;
  const monthlyRent = listing?.price ? Number(listing.price) : null;
  const score = solvencyScore({
    monthlyIncome: input.monthly_income,
    monthlyRent,
    employmentType: input.employment_type,
    employmentMonths: input.employment_months,
    hasGuarantor: input.has_guarantor === 'on',
    documentCount: documents.length,
  });

  await db.insert(rentalApplications).values({
    id,
    orgId,
    listingId: listing?.id ?? null,
    fullName: input.full_name,
    email: input.email,
    phone: input.phone,
    monthlyIncome: String(input.monthly_income),
    monthlyRent: listing?.price ?? null,
    employmentType: input.employment_type,
    employmentMonths: input.employment_months,
    householdSize: input.household_size,
    hasGuarantor: input.has_guarantor === 'on',
    moveInDate: input.move_in_date || null,
    message: input.message || null,
    documents,
    score,
  });
  return score;
}

export async function orgApplications(orgId: string) {
  return db
    .select({
      id: rentalApplications.id,
      fullName: rentalApplications.fullName,
      email: rentalApplications.email,
      phone: rentalApplications.phone,
      monthlyIncome: rentalApplications.monthlyIncome,
      monthlyRent: rentalApplications.monthlyRent,
      employmentType: rentalApplications.employmentType,
      employmentMonths: rentalApplications.employmentMonths,
      householdSize: rentalApplications.householdSize,
      hasGuarantor: rentalApplications.hasGuarantor,
      moveInDate: rentalApplications.moveInDate,
      message: rentalApplications.message,
      documents: rentalApplications.documents,
      score: rentalApplications.score,
      status: rentalApplications.status,
      createdAt: rentalApplications.createdAt,
      listingTitle: listings.title,
    })
    .from(rentalApplications)
    .leftJoin(listings, eq(listings.id, rentalApplications.listingId))
    .where(eq(rentalApplications.orgId, orgId))
    .orderBy(desc(rentalApplications.createdAt))
    .limit(APPLICATIONS_PAGE_SIZE);
}

export async function setApplicationStatus(orgId: string, applicationId: string, status: ApplicationStatus): Promise<boolean> {
  const updated = await db
    .update(rentalApplications)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(rentalApplications.orgId, orgId), eq(rentalApplications.id, applicationId)))
    .returning({ id: rentalApplications.id });
  return updated.length > 0;
}
