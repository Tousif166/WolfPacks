// Barrel for the modern app-shell components (Phase 7). These implement the "modern Indian
// consumer app" visual language (Urban Company / Zomato / Amazon / Flipkart patterns) on the
// app's own indigo+amber brand — location bar, search, service grid, section headers, promo
// banner, chips, and the standard screen container.
export { default as ScreenContainer } from './ScreenContainer';
export { default as LocationBar } from './LocationBar';
export { default as PortalHeader } from './PortalHeader';
export { default as SearchBar } from './SearchBar';
export { default as SectionHeader } from './SectionHeader';
export { default as PromoBanner } from './PromoBanner';
export { default as ServiceGrid } from './ServiceGrid';
export { default as ServiceCardGrid } from './ServiceCardGrid';
export { default as GradientBand } from './GradientBand';
export { default as ChatWidget } from './ChatWidget';
export { default as BrandLogo } from './BrandLogo';
export { default as Confetti } from './Confetti';
export { default as ComplaintAgainstYouCard } from './ComplaintAgainstYouCard';
// Fairness-allocation walkthrough: the customer's GPS scan animation and the worker's
// "why me and not them" comparison. Both read the same roster (src/data/allocationDemo.js).
export { default as GpsAllocationScanner } from './GpsAllocationScanner';
export { default as AllocationComparisonPanel, AllocationDiagnosisCard } from './AllocationComparisonPanel';
export { Chip, ChipRow } from './Chip';
