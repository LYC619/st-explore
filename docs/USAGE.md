# Start with one card and one story

[简体中文](USAGE.zh-CN.md) · [Deployment guide](DEPLOYMENT.md)

A practical guide to importing, reading, continuing, backing up, and choosing a language in ST Explorer.

## 1. Choose a home

Use a desktop release when available, or open your own web deployment. On desktop, pick a folder on disk as your library. In the browser, each site origin and browser profile keeps its own library.

## 2. Choose your language

Open **Settings → Display → Interface language** to switch between English and Simplified Chinese. Character cards, chat logs, custom tags, saved names, built-in writing prompts, and the embedded tavern’s own language settings remain untouched.

## 3. Bring in a card

Open **Characters** and click **Import**. Start with a character PNG or JSON card, then import its chat history. On desktop, scanning a SillyTavern folder is strictly read-only.

## 4. Read and organize

Open a character, pick a story, and enter the inline reader or chat-processing workspace. Search messages, tune regular expressions, mark chapters, and save edits. Exports create separate files, and writeback is always an explicit action.

## 5. Continue a scene

Add your model endpoint in **Settings → AI settings**, then click **Continue chatting** on a story. In a browser deployment, your provider must allow cross-origin (CORS) requests.

## 6. Keep a backup

Export a backup in **Settings → Data & backups** before large imports or version updates, and keep separate backups of desktop library folders. Changing a web deployment’s domain or port creates a fresh browser storage scope.

## Troubleshooting

### An empty library after changing the URL

Open the previous address, export a backup in **Settings → Data & backups**, and import it at the new address.

### An AI request fails

Check the endpoint URL, API key, and model ID in **Settings → AI settings**. In a browser, verify that the provider permits browser requests.

### A page is blank after an update

Save open edits before refreshing, and confirm that all static assets and embedded tavern files were deployed together.
