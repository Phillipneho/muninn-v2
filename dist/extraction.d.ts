import type { ExtractionResult, ExtractedFact, ExtractedEntity } from './types.js';
export declare class FactExtractor {
    extract(content: string, sessionDate?: string): Promise<ExtractionResult>;
    private validateAndClean;
    private validateEntityType;
}
export declare function resolveEntities(extracted: ExtractedEntity[], existing: Map<string, string>): Map<string, string>;
export declare function detectContradictions(newFact: ExtractedFact, existingFacts: ExtractedFact[]): ExtractedFact[];
//# sourceMappingURL=extraction.d.ts.map