export function SignIn({ url = "/api/auth/google/start?returnTo=/shop" }: { url?: string }) {
  return (
    <main className="signin" id="main">
      <div className="signin__card">
        <span className="brand-mark" aria-hidden>
          S
        </span>
        <h1 className="signin__title">
          Shop, <em>with an agent</em>
        </h1>
        <p className="signin__sub">
          Sign in to search, watch prices and buy through your PayPal wallet. Nothing is spent
          without your OK.
        </p>
        <a className="ui-btn ui-btn-solid signin__btn" href={url}>
          Continue with Google
        </a>
      </div>
    </main>
  );
}
