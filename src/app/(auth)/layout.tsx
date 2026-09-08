export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-[100svh] flex-col justify-center safe-x"
      style={{
        paddingTop: "calc(var(--safe-top) + 2rem)",
        paddingBottom: "calc(var(--safe-bottom) + 2rem)",
      }}
    >
      <main id="main" className="mx-auto w-full max-w-sm">
        {children}
      </main>
    </div>
  );
}
