// A small, professional "team" mark — three overlapping rounded shapes in
// graduated brand-blue tones, evoking connected people/teammates rather than
// a literal letter. Works at any size (login, sidebar, favicon export) and
// reads clearly in monochrome if needed.
export default function BrandMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="40" height="40" rx="10" fill="#0f1f3d" />
      <circle cx="16" cy="17" r="7" fill="#8fb4f7" />
      <circle cx="25" cy="17" r="7" fill="#2f6feb" />
      <path d="M11 30c0-4.4 4-8 9-8s9 3.6 9 8" fill="#4c8bf5" />
    </svg>
  );
}
