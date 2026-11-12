import { formatMoney, WalletConnectCard, type WidgetContext, WidgetProvider } from "@shop/genui";
import { useId, useState } from "react";
import { useClientState } from "./store";
import { type ThemeChoice, useTheme } from "./theme";

const COOLING = [0, 5, 10, 30, 60] as const;

export function SettingsBody({ ctx }: { ctx: WidgetContext }) {
  const s = useClientState();
  const shop = s.shop?.state;
  const coolId = useId();
  const themeId = useId();
  const [theme, setTheme] = useTheme();
  const [notify, setNotify] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [saving, setSaving] = useState(false);

  return (
    <div className="settings">
      <section className="settings__band">
        <h3 className="settings__h">Wallet</h3>
        <WidgetProvider value={ctx}>
          <WalletConnectCard variant="settings" />
        </WidgetProvider>
      </section>

      <section className="settings__band">
        <h3 className="settings__h">Spending</h3>
        <div className="settings__row">
          <label htmlFor={coolId}>
            <span className="settings__label">Undo window</span>
            <span className="settings__hint">
              Purchases are authorized first and captured after this. Undo voids them, no money
              moves.
            </span>
          </label>
          <select
            id={coolId}
            className="select"
            value={shop?.coolingOffMinutes ?? 10}
            disabled={!shop || saving}
            onChange={async (e) => {
              setSaving(true);
              try {
                await ctx.invoke("settings.update", { coolingOffMinutes: Number(e.target.value) });
              } finally {
                setSaving(false);
              }
            }}
          >
            {COOLING.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Off (charge at once)" : `${m} minutes`}
              </option>
            ))}
          </select>
        </div>
        {shop && (
          <p className="settings__note">
            Purchases above <strong>{formatMoney(shop.stepUpAbove)}</strong> ask for your passkey.
          </p>
        )}
      </section>

      <section className="settings__band">
        <h3 className="settings__h">Notifications</h3>
        <div className="settings__row">
          <span>
            <span className="settings__label">Price hits and purchases</span>
            <span className="settings__hint">So you can undo a purchase while you're away.</span>
          </span>
          {notify === "unsupported" ? (
            <span className="settings__hint">Not supported here</span>
          ) : notify === "granted" ? (
            <span className="ui-label">On</span>
          ) : (
            <button
              type="button"
              className="pill-btn"
              disabled={notify === "denied"}
              onClick={async () => setNotify(await Notification.requestPermission())}
            >
              {notify === "denied" ? "Blocked in browser" : "Turn on"}
            </button>
          )}
        </div>
      </section>

      <section className="settings__band">
        <h3 className="settings__h">Appearance</h3>
        <div className="settings__row">
          <label htmlFor={themeId} className="settings__label">
            Theme
          </label>
          <select
            id={themeId}
            className="select"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemeChoice)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </section>
    </div>
  );
}
