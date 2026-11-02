# Native deployment and acceptance gate

The development source is not an installed or completed release. No candidate
archive is produced by this verification phase. Update the existing owned
private account plugin; do not create another identity, uninstall the current
plugin, invoke a separate Codex CLI, or publish the public GitHub project.

## Verified baseline

The account plugin source is version 0.4.6. Its exact backend identity and
current release guard have been read through Plugin Creator and stored only in
private artifacts. The portable MCP configuration is unchanged. The generated
compatibility configuration differs only by explicit stdio and empty env
defaults; it has no custom data-root override. Preserve that configuration.
The full existing prompt, keywords and style assets must also be retained.

An isolated migration used the account release's actual Store and dependencies.
The candidate opened its database, and the old version could read it back.
All stored board JSON, 28 synthetic tasks, three synthetic members, immutable
work records and panel selection remained unchanged. This is a migration test,
not a backup or inspection of the user's production database.

The actual native timer task's creation metadata reports 0.164.0-alpha.11.1.
The existing control process reports 0.166.0 in its handshake. They are separate
processes and must not be presented as the same desktop runtime. Node 24.15.0
and PowerShell 7.6.5 were checked. No minimum desktop shell build has been
established. Require actual Hook, metadata, MCP/UI messaging and native
collaboration capabilities; do not infer them from a CLI version.

## Approval and update

Obtain approval to update the existing private plugin and enable its three
metadata-only native handlers for explicitly bound active workbenches. This
is broader than the currently authorized single-root development probe.
No prompts, transcript text, tool payloads, credentials or token data are kept.
The handler persists only supported event/agent/turn IDs, type and time.

After approval, refresh the exact current release identity, preserve its
configuration and assets, and prepare the reviewed update. Use the supported
Plugin Creator update with the exact plugin ID and expected release guard.
Read back the changed files and release. A saved release alone does not prove
that an existing desktop MCP connection loaded it.

The source now declares the reviewed Hook file through portable and compatibility
manifest paths. Installation still requires normal client review: **Settings > Hooks**
or **Review hooks** in the composer. Never edit trust records. Verify all three
handlers belong to the actual plugin source and are enabled/trusted.

Before deployment, confirm the plugin's actual persistent data root from the
supported runtime and create a consistent backup. After deployment, verify
the same boards, task/member IDs, records and assets. The isolated migration
does not replace this installed-data check.

## Avoid duplicate sources

The development probe writes only its isolated journal; the packaged handler
uses the plugin's own PLUGIN_DATA journal. The MCP view must consume one source.
Keep the probe until an actual plugin-owned callback is verified. Then retire
only the three exact saved probe definitions, preserving unrelated handlers.
Do not remove a group that shifts unrelated positional trust keys. The
migration helper is a pure plan and must not be mistaken for an applied change.

## Remaining desktop checks

Confirm that the real panel protocol reports the new version, not merely that
the account release was updated. Closing a panel is not verified to replace its
MCP process. If the connection remains old, use only an actually available,
supported refresh; do not invent a menu or restart the whole app without
approval. Official MCP connection documentation describes a metadata refresh
and a new-conversation test, but that is not proof of a hot reload of this
existing native conversation. Keep the original binding and history intact.

Manual visual acceptance is necessary because GUI automation is prohibited:
open the original test workbench, inspect its exact native tree and automatic
state change, open the selected child and submit an explicit same-child
continuation. Check the resulting exact-target receipt. A navigation API
acknowledgment is not visual certification. An old child missing from the live
parent directory must produce an honest failure, never a replacement spawn.

References: [Hook loading and normal desktop review](https://learn.chatgpt.com/docs/hooks),
[plugin manifests and environment](https://developers.openai.com/plugins/build/plugins),
[connection metadata refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt).
