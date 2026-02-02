export type PaperProof = {
  id: string;
  title: string;
  authors: string;
  year: number;
  keywords: string[];
  proofExcerpt: string;
};

export const PAPER_LIBRARY: PaperProof[] = [
  {
    id: "paper-evp-compactness-1910",
    title: "Extreme Value via Compactness in Metric Spaces",
    authors: "E. Hadamard",
    year: 1910,
    keywords: ["extreme value theorem", "compactness", "continuous", "closed interval"],
    proofExcerpt:
      "Let f be continuous on a compact set K. By compactness, f(K) is compact. " +
      "In ℝ, compactness implies closed and bounded. Hence f(K) has a maximum M and minimum m. " +
      "Choose x_max, x_min in K with f(x_max)=M and f(x_min)=m. This yields the extreme value theorem."
  },
  {
    id: "paper-heine-borel-1900",
    title: "Heine–Borel Covering Lemma and Applications",
    authors: "E. Borel",
    year: 1900,
    keywords: ["heine-borel", "closed interval", "compactness", "open cover"],
    proofExcerpt:
      "A closed interval [a,b] is compact because every open cover admits a finite subcover. " +
      "For continuous f, the image of a compact set is compact. " +
      "Thus f([a,b]) is compact and attains its supremum and infimum."
  },
  {
    id: "paper-contraction-1922",
    title: "Contraction Mappings and Fixed Points",
    authors: "S. Banach",
    year: 1922,
    keywords: ["contraction", "fixed point", "complete metric space", "iteration"],
    proofExcerpt:
      "If (X,d) is complete and T is a contraction, the sequence x_{n+1}=T(x_n) is Cauchy " +
      "and converges to a fixed point. Uniqueness follows by the contraction inequality."
  },
  {
    id: "paper-cauchy-schwarz-1885",
    title: "The Cauchy–Schwarz Inequality Revisited",
    authors: "H. A. Schwarz",
    year: 1885,
    keywords: ["cauchy-schwarz", "inner product", "inequality"],
    proofExcerpt:
      "Consider 0 ≤ ⟨x - t y, x - t y⟩ as a quadratic in t. " +
      "The discriminant is non-positive, giving ⟨x,y⟩^2 ≤ ⟨x,x⟩⟨y,y⟩."
  }
];
