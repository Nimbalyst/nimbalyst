import React, {useEffect} from "react";

export function AnalyticsSettingsPanel() {
  const [loading, setLoading] = React.useState<boolean>(true);
  const [analyticsEnabled, setAnalyticsEnabled] = React.useState<boolean>(false);
  const [analyticsId, setAnalyticsId] = React.useState<string>('');

  useEffect(() => {
    (async () => {
      setAnalyticsId(await window.electronAPI.analytics?.getDistinctId() ?? '');
      setAnalyticsEnabled(await window.electronAPI.analytics?.allowedToSendAnalytics() ?? false)
      setLoading(false);
    })();
  }, []);

  const toggleAnalytics = async (enabled: boolean) => {
    if (enabled) {
      await window.electronAPI.analytics?.optIn();
    } else {
      await window.electronAPI.analytics?.optOut();
    }
    setAnalyticsEnabled(enabled);
  }

  if (loading) {
    return <></>
  }

  return (
    <div className="provider-panel">
      <div className="provider-panel-header">
        <h3 className="provider-panel-title">Analytics</h3>
        <p className="provider-panel-description">
          Opt in to allow us to collect anonymous usage data to help improve the product.
          You can opt out again at any time.
        </p>
      </div>

      <div className="provider-enable">
        <span className="provider-enable-label">Send anonymous usage data</span>
        <label className="provider-toggle">
          <input
            type="checkbox"
            checked={analyticsEnabled}
            onChange={(e) => toggleAnalytics(e.target.checked)}
          />
          <span className="provider-toggle-slider"></span>
        </label>
      </div>

      <div className="provider-panel-header">
        <p className="provider-panel-description">
          Your analytics ID: <code>{analyticsId}</code>
        </p>
      </div>
    </div>
  );
}
