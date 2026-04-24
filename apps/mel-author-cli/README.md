# MEL Author CLI

Standalone CLI for testing the MEL Author Agent outside the Studio webapp.

```bash
pnpm --silent --filter @manifesto-ai/mel-author-cli author \
  --source apps/mel-author-cli/fixtures/taskflow.mel \
  --request "Add clearDoneTasks to remove completed tasks" \
  --out temp/author-run.json
```

```bash
pnpm --silent --filter @manifesto-ai/mel-author-cli interactive \
  --source apps/mel-author-cli/fixtures/taskflow.mel
```

Default provider is Ollama:

```bash
OLLAMA_BASE_URL=http://100.84.214.42:11434/v1
OLLAMA_MODEL=gemma4:e4b
```

Use Vercel AI Gateway by setting:

```bash
AGENT_MODEL_PROVIDER=gateway
AI_GATEWAY_API_KEY=...
AI_GATEWAY_MODEL=google/gemma-4-26b-a4b-it
```

The default `lens` strategy encourages scoped source reads and
`patchDeclaration`. Use `--strategy full-source` to compare against the older
full-source workflow.
