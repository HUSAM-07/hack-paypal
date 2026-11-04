# Eval reference

Earlier runs behind the card's "Measured" numbers. Task B20 re-runs them in-repo.

- `run-a/` and `run-b/`: GPT, Gemini and Sonnet shopper agents given a buyer request, with the creator test, a same-creator placebo, or nothing. Metric: Winix brand share of purchases. Pooled, these are the 146 purifier sessions on the card (Winix 41/56 test vs 16/54 placebo).
- `pooled-all-runs.txt`: all runs pooled. Lift is lower (+32pp, 80% lower bound +27pp), and the abstain-allowed run showed about zero lift. The card's +44pp must be re-checked before the video (task B21).
- The scripts call an OpenAI-compatible gateway via `LITELLM_BASE_URL` / `LITELLM_API_KEY`.
- The `raw/` review fixtures are not committed (third-party review text). Rebuild them from licensed or our own fixtures (task B4).
