export type BedForRollup = { monthlyRent: string | null; tenantId: string | null };

export type BedRollup = {
  totalBeds: number;
  occupiedBeds: number;
  potentialRent: number;
  occupiedRent: number;
  occupancyPct: number;
};

const rentOf = (bed: BedForRollup) => Number(bed.monthlyRent ?? 0) || 0;

export function rollupBeds(beds: BedForRollup[]): BedRollup {
  const occupied = beds.filter((bed) => bed.tenantId !== null);
  const totalBeds = beds.length;
  return {
    totalBeds,
    occupiedBeds: occupied.length,
    potentialRent: beds.reduce((sum, bed) => sum + rentOf(bed), 0),
    occupiedRent: occupied.reduce((sum, bed) => sum + rentOf(bed), 0),
    occupancyPct: totalBeds > 0 ? Math.round((occupied.length / totalBeds) * 100) : 0,
  };
}
