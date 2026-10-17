/**
 * The labelling rules — a table, not an if-chain.
 *
 * One row per known family of MCP tools. A row says: if a tool name (or a
 * server name, for names a human would find ambiguous) looks like this, then
 * these resources are what it feeds from and emits to, at this confidence.
 *
 * Conventions, all enforced by the matcher at the bottom:
 *   - `anyOf` lists are LOWERCASE substrings of the tool name. The matcher
 *     lowercases both the namespaced name (`github.get_issue`) and the bare
 *     tool name (`get_issue`) before testing, so `readfile` matches `readFile`.
 *   - `patterns` are regex sources tried with the `i` flag, for names where a
 *     bare substring is unsafe (`create_pr` is a substring of `create_product`).
 *   - `serverAnyOf` narrows a row to servers whose id/name contains one of the
 *     strings. Used for genuinely ambiguous tool names: a bare `execute` means
 *     a database query under `postgres` and a shell command under `shell`.
 *   - `veto` blocks a row even when a substring matched. In the tracker family
 *     the prefix decides the domain (`linear_...`) and the verb decides the
 *     direction (`create` vs `get`), so each direction vetoes the other's verbs.
 *   - FIRST MATCH WINS, top to bottom. Rows are ordered specific -> generic,
 *     and the `unknown.fallback` row is last on purpose.
 *
 * Confidence is honest about the inference, not about the danger: a rule that
 * saw a verb and applied it to a folder it cannot name gets 0.5, one that
 * recognized a well-known family verb gets 0.6-0.7, and the fallback gets 0.2.
 * Every number says "this reading of the name is right this often", and the
 * graph shows it on every edge.
 */

import type { ResourceDecl } from "@lethalpath/schema";

type Trust = NonNullable<ResourceDecl["trust"]>;
type Sensitivity = NonNullable<ResourceDecl["sensitivity"]>;
type Visibility = NonNullable<ResourceDecl["visibility"]>;

/** The resource side of a rule: a stable slug plus the labels we can defend. */
export interface ResourceShape {
  id: string;
  kind: string;
  trust?: Trust;
  sensitivity?: Sensitivity;
  visibility?: Visibility;
}

export interface Rule {
  /** Stable id, shows up in tests and when debugging a wrong label. */
  id: string;
  anyOf?: readonly string[];
  patterns?: readonly string[];
  serverAnyOf?: readonly string[];
  veto?: readonly string[];
  reads?: readonly ResourceShape[];
  writes?: readonly ResourceShape[];
  /** 0..1 — how often this reading of the name is the right one. */
  conf: number;
  note?: string;
  /** The last row only: fires when nothing above matched. */
  fallback?: boolean;
}

// ---------------------------------------------------------------------------
// Resources. Ids are stable slugs; kinds are the words a person reads.
// ---------------------------------------------------------------------------

/** Files under a working directory. Private by default; the locator is scoped later. */
const PROJECT_FOLDER: ResourceShape = {
  id: "project-folder",
  kind: "project folder",
  sensitivity: "private",
};

/** The local clone. Commits stay local; only a push leaves. */
const LOCAL_REPO: ResourceShape = { id: "local-repo", kind: "local repo", sensitivity: "private" };

/** A remote that the public can fetch. Push/PR tooling writes here. */
const PUBLIC_REPO_SINK: ResourceShape = {
  id: "public-repo",
  kind: "public repo",
  visibility: "public",
};

/** Reading repo contents via the API: code can be attacker-influenced (fork PRs), so semi. */
const PUBLIC_REPO_SOURCE: ResourceShape = {
  id: "public-repo",
  kind: "public repo",
  trust: "semi",
};

/** Issues and PR bodies: anyone with an account can write text into them. */
const GITHUB_ISSUE_READ: ResourceShape = {
  id: "github-issue",
  kind: "github issue",
  trust: "untrusted",
};
const GITHUB_ISSUE_WRITE: ResourceShape = {
  id: "github-issue",
  kind: "github issue",
  trust: "untrusted",
  visibility: "public",
};

/** Jira/Linear-style trackers: same trust story, different words. */
const ISSUE_TRACKER_READ: ResourceShape = {
  id: "issue-tracker",
  kind: "issue tracker",
  trust: "untrusted",
};
const ISSUE_TRACKER_WRITE: ResourceShape = {
  id: "issue-tracker",
  kind: "issue tracker",
  trust: "untrusted",
  visibility: "public",
};

/** The mailbox: strangers can put text in it, its contents are private. */
const INBOX: ResourceShape = {
  id: "inbox",
  kind: "inbox",
  trust: "untrusted",
  sensitivity: "private",
};

/** Outbound mail is a one-way door out of the context. */
const OUTBOUND_EMAIL: ResourceShape = {
  id: "outbound-email",
  kind: "outbound email",
  visibility: "public",
};

/** A chat channel: members (and sometimes guests) write; posts are visible to all of them. */
const CHAT_READ: ResourceShape = { id: "chat-channel", kind: "chat channel", trust: "untrusted" };
const CHAT_WRITE: ResourceShape = {
  id: "chat-channel",
  kind: "chat channel",
  visibility: "public",
};

/** Anything fetched from the open web. */
const WEB_PAGE: ResourceShape = { id: "web-page", kind: "web page", trust: "untrusted" };

/** An HTTP endpoint a tool POSTs to: arbitrary egress. */
const WEB_ENDPOINT: ResourceShape = {
  id: "web-endpoint",
  kind: "web endpoint",
  visibility: "public",
};

const DATABASE: ResourceShape = { id: "database", kind: "database", sensitivity: "private" };

/**
 * The local shell is the classic full-access tool: one grant that can read
 * anything and write anywhere the process user can reach. Rules also cannot
 * see which paths a command will touch, so the shell itself is modelled as
 * one private resource that the tool both reads and writes, at conf 0.5.
 */
const LOCAL_SHELL: ResourceShape = { id: "local-shell", kind: "local shell", sensitivity: "private" };

const CLOUD_STORAGE: ResourceShape = {
  id: "cloud-storage",
  kind: "cloud storage",
  sensitivity: "private",
};

/** What the agent remembers between calls. Often holds pasted secrets. */
const AGENT_MEMORY: ResourceShape = {
  id: "agent-memory",
  kind: "agent memory",
  sensitivity: "private",
};

const CALENDAR: ResourceShape = {
  id: "calendar",
  kind: "calendar",
  trust: "semi",
  sensitivity: "internal",
};

const SHARED_DOC: ResourceShape = {
  id: "shared-doc",
  kind: "shared document",
  trust: "semi",
  sensitivity: "internal",
};

const OPS_LOGS: ResourceShape = { id: "ops-logs", kind: "ops logs", trust: "semi", sensitivity: "internal" };

/**
 * The fallback: a tool we could not classify. Modelled as ONE semi-trusted
 * read so it can never be silently treated as harmless — it shows up in the
 * graph for review and in `unlabelled`. conf 0.2 is the honest number.
 */
const UNKNOWN_OUTPUT: ResourceShape = {
  id: "unknown-tool-output",
  kind: "unknown tool output",
  trust: "semi",
};

// ---------------------------------------------------------------------------
// The table. Order is the priority; keep the comments when editing rows.
// ---------------------------------------------------------------------------

export const RULES: readonly Rule[] = [
  {
    id: "fs.read",
    anyOf: ["filesystem.read", "filesystem_read", "filesystemread", "read_file", "readfile", "read_text_file", "read_multiple_files", "fs.read", "fs_read"],
    reads: [PROJECT_FOLDER],
    conf: 0.6,
    note: "reading a file brings private folder contents into the context",
  },
  {
    id: "fs.write",
    anyOf: ["filesystem.write", "filesystem_write", "filesystemwrite", "write_file", "writefile", "write_text_file", "edit_file", "editfile", "create_file", "createfile", "move_file", "movefile", "copy_file", "copyfile", "delete_file", "deletefile", "make_directory", "create_directory", "createdirectory", "mkdir", "rename_file", "fs.write", "fs_write"],
    writes: [PROJECT_FOLDER],
    conf: 0.6,
    note: "any of these mutate files in the folder the server was pointed at",
  },
  {
    id: "fs.list",
    anyOf: ["list_directory", "listdirectory", "list_files", "listfiles", "directory_tree", "directorytree", "get_file_info", "getfileinfo", "readdir", "stat_file", "statfile", "search_files", "searchfiles", "listdir"],
    reads: [PROJECT_FOLDER],
    conf: 0.5,
    note: "listings and metadata still leak names and structure",
  },
  {
    id: "git.read",
    anyOf: ["git.show", "git_show", "gitshow", "git_status", "git.status", "gitstatus", "git_diff", "git.diff", "gitdiff", "git_log", "git.log", "gitlog", "git.read", "git_read", "git_fetch", "git.fetch", "gitfetch"],
    reads: [LOCAL_REPO],
    conf: 0.5,
  },
  {
    id: "git.write",
    anyOf: ["git.commit", "git_commit", "gitcommit", "git_add", "git.add", "gitadd", "git_checkout", "git.checkout", "gitcheckout", "git_create_branch", "git.create_branch", "git.init", "git_init", "gitinit", "git_merge", "git.merge", "git_reset", "git.reset", "git_stash", "git.clone", "git_amend", "git_rebase"],
    writes: [LOCAL_REPO],
    conf: 0.5,
    note: "local history changes stay local until a push; still private",
  },
  {
    id: "tracker.read",
    anyOf: ["jira", "linear", "asana", "trello", "clickup"],
    veto: ["create", "update", "delete", "add", "remove", "post", "send", "transition"],
    reads: [ISSUE_TRACKER_READ],
    conf: 0.5,
    note: "prefix decides the domain, verb decides direction; read verbs pass the veto",
  },
  {
    id: "tracker.write",
    anyOf: ["jira", "linear", "asana", "trello", "clickup"],
    veto: ["get", "list", "search", "read", "fetch", "view", "export"],
    writes: [ISSUE_TRACKER_WRITE],
    conf: 0.5,
  },
  {
    id: "github.read",
    anyOf: ["github.read", "github_read", "get_issue", "list_issues", "search_issues", "issue_read", "issueread", "get_issue_comments", "list_issue_comments", "get_pull_request", "list_pull_requests", "pull_request_read", "pullrequestread", "get_pull_request_comments", "get_pull_request_files", "get_review_comments", "get_discussion", "issues.get", "issues.list"],
    reads: [GITHUB_ISSUE_READ],
    conf: 0.7,
    note: "anyone can write an issue or a PR body; reading it is reading attacker text",
  },
  {
    id: "github.issue.write",
    anyOf: ["create_issue", "update_issue", "issue_write", "issuewrite", "add_issue_comment", "create_issue_comment", "add_comment", "create_pull_request_review", "submit_pull_request_review", "add_review_comment", "update_issue_comment", "delete_issue_comment", "lock_issue", "close_issue"],
    writes: [GITHUB_ISSUE_WRITE],
    conf: 0.6,
    note: "comments and issue text land where the public can read them",
  },
  {
    id: "git.push",
    anyOf: ["git.push", "git_push", "gitpush", "push_files", "pushfiles", "push_to_remote", "pushtoremote", "create_pull_request", "createpullrequest", "open_pull_request", "submit_pull_request", "publish_branch", "git_push_files"],
    patterns: ["create_?pr(?:$|[._-])"],
    writes: [PUBLIC_REPO_SINK],
    conf: 0.7,
    note: "publishing to a remote is the canonical public sink; assumes the remote is public",
  },
  {
    id: "github.repo.read",
    anyOf: ["get_file_contents", "search_code", "search_repositories", "get_repository", "list_repositories", "list_commits", "get_commit", "read_repository_file"],
    reads: [PUBLIC_REPO_SOURCE],
    conf: 0.5,
    note: "repo contents can be attacker-influenced through forks and PRs, but usually are not",
  },
  {
    id: "github.repo.write",
    anyOf: ["create_or_update_file", "create_branch", "merge_pull_request", "update_file", "fork_repository", "delete_branch", "create_repository"],
    writes: [PUBLIC_REPO_SINK],
    conf: 0.5,
    note: "writing repo content via the API; whether the repo is public is not knowable from the name",
  },
  {
    id: "gmail.read",
    anyOf: ["gmail.read", "gmail_read", "read_email", "reademail", "search_email", "searchemail", "get_email", "getemail", "list_emails", "listemails", "fetch_emails", "fetchemails", "read_inbox", "readinbox", "get_email_message", "fetch_messages", "fetchemessages"],
    reads: [INBOX],
    conf: 0.6,
    note: "strangers can email you; the mailbox also holds private mail",
  },
  {
    id: "gmail.send",
    anyOf: ["gmail.send", "gmail_send", "send_email", "sendemail", "send_gmail", "send_mail", "sendmail", "reply_email", "replyemail", "send_reply", "sendreply"],
    writes: [OUTBOUND_EMAIL],
    conf: 0.6,
    note: "one call puts context text on the wire, out of your control",
  },
  {
    id: "gmail.hint",
    anyOf: ["list_messages", "search_messages", "get_messages", "get_message", "read_messages"],
    serverAnyOf: ["gmail", "mail", "email", "imap", "smtp"],
    reads: [INBOX],
    conf: 0.5,
    note: "bare message verbs need the server name to mean the mailbox",
  },
  {
    id: "slack.read",
    anyOf: ["conversations_history", "conversationshistory", "conversations_replies", "conversationsreplies", "slack.read", "slack_read", "read_channel", "readchannel", "channel_history", "channelhistory", "read_chat", "get_channel_messages", "list_channels"],
    reads: [CHAT_READ],
    conf: 0.5,
  },
  {
    id: "slack.send",
    anyOf: ["slack.send", "slack_send", "post_message", "postmessage", "send_message", "sendmessage", "send_chat_message", "post_chat_message", "chat_post", "chat.postmessage", "slack_post", "send_slack_message", "post_to_channel", "send_channel_message", "sendchannelmessage"],
    writes: [CHAT_WRITE],
    conf: 0.6,
    note: "a channel post is visible to everyone in the room",
  },
  {
    id: "slack.hint",
    anyOf: ["get_messages", "search_messages", "list_messages", "get_message", "read_messages"],
    serverAnyOf: ["slack", "chat", "discord", "teams", "matrix"],
    reads: [CHAT_READ],
    conf: 0.5,
  },
  {
    id: "db.hint",
    anyOf: ["execute", "exec"],
    serverAnyOf: ["postgres", "postgresql", "sqlite", "mysql", "mariadb", "mongo", "mongodb", "database", "db", "duckdb", "clickhouse", "bigquery", "snowflake", "supabase", "redis", "cassandra", "dynamodb", "sql"],
    reads: [DATABASE],
    writes: [DATABASE],
    conf: 0.4,
    note: "a bare execute under a database server can read or write; direction is not in the name",
  },
  {
    id: "db.write",
    anyOf: ["insert_row", "insertrow", "insert_rows", "insert_document", "insert_documents", "insert_one", "insert_many", "insertmany", "update_row", "update_rows", "update_document", "update_documents", "update_one", "update_many", "updatemany", "delete_row", "delete_rows", "delete_document", "delete_documents", "delete_one", "delete_many", "deletemany", "create_table", "createtable", "drop_table", "droptable", "truncate_table", "truncatetable", "upsert_row", "drop_database", "drop_collection", "write_query"],
    writes: [DATABASE],
    conf: 0.6,
  },
  {
    id: "db.read",
    anyOf: ["postgres.query", "postgres_query", "postgres.read", "postgres_read", "postgres", "postgresql", "pg.query", "sqlite", "mysql", "mariadb", "mssql", "sql", "database", "db.query", "db_query", "run_sql", "runsql", "execute_sql", "executesql", "execute_query", "executequery", "read_query", "readquery", "select_query", "selectquery", "select_rows", "fetch_rows", "fetchrows", "fetch_documents", "fetchdocuments", "find_documents", "finddocuments", "find_one", "find_many", "query_database", "database_query", "list_tables", "listtables", "describe_table", "show_tables", "get_schema", "get_database_schema", "duckdb", "clickhouse", "bigquery", "snowflake", "cassandra", "dynamodb", "supabase", "mongo_query", "mongodb", "mongo.find", "mongo_find", "mongofind", "redis.get", "redis_get", "redis.read", "elasticsearch.query"],
    reads: [DATABASE],
    conf: 0.6,
    note: "the example says query means read; a query can also mutate, see db.hint for bare execute",
  },
  {
    id: "web.read",
    anyOf: ["web.fetch", "web_fetch", "webfetch", "fetch_url", "fetchurl", "fetch_page", "fetchpage", "browser", "http_get", "httpget", "get_url", "geturl", "get_webpage", "getwebpage", "read_url", "readurl", "scrape", "crawl", "navigate", "open_page", "openpage", "openurl", "open_url", "web_search", "websearch", "search_web", "searchweb", "searxng", "brave_search", "duckduckgo", "serper", "search_engine", "google_search", "bing_search", "fetch"],
    reads: [WEB_PAGE],
    conf: 0.7,
    note: "the open web is the textbook untrusted input; anyone can write a page",
  },
  {
    id: "web.write",
    anyOf: ["http_post", "httppost", "post_request", "postrequest", "post_json", "postjson", "http_put", "httpput", "http_patch", "send_request", "sendrequest", "send_http_request", "sendhttprequest", "webhook", "post_data", "postdata", "api_post", "call_webhook", "notify_webhook", "upload_to_url"],
    writes: [WEB_ENDPOINT],
    conf: 0.5,
    note: "a POST can carry context text to any endpoint the tool is configured with",
  },
  {
    id: "shell.exec",
    anyOf: ["shell.exec", "shell_exec", "shellexec", "run_command", "runcommand", "execute_bash", "executebash", "execute_command", "executecommand", "run_terminal_cmd", "runterminalcmd", "run_shell", "runshell", "execute_shell", "executeshell", "terminal", "bash", "zsh", "powershell", "subprocess", "execute_code", "executecode", "run_code", "runcode", "code_interpreter", "codeinterpreter", "jupyter", "os.system", "os_system", "python_exec", "run_python", "execute_python", "run_script", "runscript", "shell", "cmd.exe", "cmdexe"],
    reads: [LOCAL_SHELL],
    writes: [LOCAL_SHELL],
    conf: 0.5,
    note: "the classic full-access tool: sees everything the process user sees (see LOCAL_SHELL)",
  },
  {
    id: "shell.hint",
    anyOf: ["execute", "exec", "run", "command", "cmd"],
    serverAnyOf: ["shell", "bash", "terminal", "zsh", "powershell", "exec", "cmd", "process", "system"],
    reads: [LOCAL_SHELL],
    writes: [LOCAL_SHELL],
    conf: 0.4,
    note: "bare verbs only mean a shell when the server is one",
  },
  {
    id: "storage.read",
    anyOf: ["s3.get", "s3_get", "s3.read", "s3_read", "get_object", "getobject", "read_object", "readobject", "download_file", "downloadfile", "download_object", "downloadobject", "gcs.get", "gcs_get", "get_drive_file", "drive.read", "drive_read", "read_blob", "readblob", "list_buckets", "listbuckets", "list_objects", "listobjects", "storage.read", "storage_read"],
    reads: [CLOUD_STORAGE],
    conf: 0.5,
  },
  {
    id: "storage.write",
    anyOf: ["s3.put", "s3_put", "s3.write", "s3_write", "put_object", "putobject", "upload_file", "uploadfile", "upload_object", "uploadobject", "upload_blob", "uploadblob", "write_object", "writeobject", "gcs.write", "gcs_write", "drive.write", "drive_write", "create_bucket", "createbucket", "upload_to_s3", "storage.write", "storage_write"],
    writes: [CLOUD_STORAGE],
    conf: 0.5,
    note: "a user-owned bucket is private; whether a given bucket is world-readable is not in the name",
  },
  {
    id: "memory.read",
    anyOf: ["memory.read", "memory_read", "read_memory", "readmemory", "search_memory", "searchmemory", "search_nodes", "searchnodes", "open_nodes", "opennodes", "read_graph", "readgraph", "recall", "get_memory", "getmemory", "retrieve_memory", "retrievememory", "memory.search", "query_memory", "load_memory"],
    reads: [AGENT_MEMORY],
    conf: 0.5,
  },
  {
    id: "memory.write",
    anyOf: ["memory.write", "memory_write", "write_memory", "writememory", "store_memory", "storememory", "save_memory", "savememory", "add_memory", "addmemory", "remember", "create_entities", "createentities", "add_observations", "addobservations", "delete_entities", "deleteentities", "delete_observations", "delete_relations", "update_memory", "memory.store", "memory_add"],
    writes: [AGENT_MEMORY],
    conf: 0.5,
    note: "what the agent remembers is a private store; secrets get pasted there",
  },
  {
    id: "calendar.read",
    anyOf: ["calendar.read", "calendar_read", "list_events", "listevents", "get_event", "getevent", "read_calendar", "readcalendar", "list_calendars", "find_events", "search_events", "searchevents", "get_calendar"],
    reads: [CALENDAR],
    conf: 0.4,
  },
  {
    id: "calendar.write",
    anyOf: ["calendar.write", "calendar_write", "create_event", "createevent", "update_event", "delete_event", "add_event", "addevent", "schedule_event", "scheduleevent", "create_calendar_event", "accept_event", "respond_event"],
    writes: [CALENDAR],
    conf: 0.4,
    note: "events are shared by nature; sensitivity is internal, not private",
  },
  {
    id: "docs.read",
    anyOf: ["notion.read", "notion_read", "get_page", "getpage", "read_page", "readpage", "search_pages", "searchpages", "get_document", "getdocument", "read_document", "readdocument", "get_wiki_page", "confluence", "list_pages", "listpages", "fetch_document", "get_block", "retrieve_page", "read_doc"],
    reads: [SHARED_DOC],
    conf: 0.5,
  },
  {
    id: "docs.write",
    anyOf: ["notion.write", "notion_write", "create_page", "createpage", "update_page", "updatepage", "append_block", "appendblock", "append_to_page", "create_document", "createdocument", "update_document", "updatedocument", "create_wiki_page", "move_page", "duplicate_page", "write_doc"],
    writes: [SHARED_DOC],
    conf: 0.5,
  },
  {
    id: "logs.read",
    anyOf: ["sentry", "grafana", "search_logs", "searchlogs", "query_logs", "querylogs", "get_logs", "getlogs", "read_logs", "readlogs", "fetch_logs", "list_logs", "get_errors", "geterrors", "get_trace", "gettrace", "list_traces", "list_incidents", "read_metrics", "query_metrics", "get_metric"],
    reads: [OPS_LOGS],
    conf: 0.5,
    note: "logs routinely contain tokens and PII; internal rather than private",
  },
  {
    id: "unknown.fallback",
    fallback: true,
    reads: [UNKNOWN_OUTPUT],
    conf: 0.2,
    note: "not classified: visible in the graph for review, listed in `unlabelled`",
  },
];

/** The id of the fallback row, so callers can tell "matched" from "unknown". */
export const UNKNOWN_RULE_ID = "unknown.fallback";

// ---------------------------------------------------------------------------
// Server scripts: what a well-known server exposes when mcp.json only names it.
// ---------------------------------------------------------------------------

/**
 * Claude's mcp.json (and VS Code's) lists servers, not tools — tools are
 * discovered by the client at runtime. When an entry comes without a tool
 * list this table expands the server's CONVENTIONAL tool set so the scan has
 * something to work with; every expanded tool is labelled by the rules above
 * and if it is not, it lands in `unlabelled` like any other unknown. This is
 * a fallback for a missing `tools` list, not a catalog; prefer real tool
 * discovery when the capture has it.
 *
 * Matching is lowercase substring on the server name, first row wins, so
 * `github` must stay above `git`.
 */
export interface KnownServer {
  match: readonly string[];
  tools: readonly string[];
}

export const KNOWN_SERVER_TOOLS: readonly KnownServer[] = [
  {
    match: ["github"],
    tools: ["get_issue", "list_issues", "search_issues", "get_issue_comments", "create_issue", "add_issue_comment", "update_issue", "get_pull_request", "list_pull_requests", "create_pull_request", "get_pull_request_comments", "create_pull_request_review", "get_file_contents", "create_or_update_file", "push_files", "search_code", "search_repositories", "merge_pull_request", "list_commits", "get_commit"],
  },
  {
    match: ["git"],
    tools: ["status", "diff", "show", "log", "commit", "add", "push", "create_branch", "checkout", "init"],
  },
  {
    match: ["filesystem", "file-system", "files", "fs", "directory", "dir"],
    tools: ["read_file", "read_text_file", "write_file", "edit_file", "list_directory", "create_directory", "move_file", "delete_file", "search_files", "get_file_info"],
  },
  {
    match: ["slack"],
    tools: ["post_message", "send_message", "conversations_history", "conversations_replies", "get_channel_messages"],
  },
  {
    match: ["gmail", "mail", "email", "imap", "smtp"],
    tools: ["read_email", "search_email", "send_email", "list_emails", "fetch_emails"],
  },
  {
    match: ["postgres", "postgresql", "pg"],
    tools: ["query", "execute", "list_tables", "describe_table"],
  },
  {
    match: ["sqlite"],
    tools: ["query", "execute", "list_tables", "describe_table"],
  },
  {
    match: ["mysql", "mariadb", "sql", "database", "db"],
    tools: ["query", "execute", "list_tables", "describe_table"],
  },
  {
    match: ["browser", "playwright", "puppeteer", "chrome", "selenium", "crawl"],
    tools: ["browser_navigate", "browser_snapshot", "browser_fetch"],
  },
  {
    match: ["memory", "knowledge", "graphiti", "mem0"],
    tools: ["search_nodes", "open_nodes", "read_graph", "create_entities", "add_observations", "delete_entities"],
  },
  {
    match: ["notion", "confluence", "wiki", "docs", "document"],
    tools: ["get_page", "search_pages", "create_page", "update_page", "append_block"],
  },
];

/** The conventional tool set for a server name/command haystack, if known. */
export function expandServerTools(haystack: string): readonly string[] | undefined {
  const text = haystack.toLowerCase();
  for (const entry of KNOWN_SERVER_TOOLS) {
    if (entry.match.some((m) => text.includes(m))) return entry.tools;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The matcher.
// ---------------------------------------------------------------------------

export interface ToolFacts {
  /** The namespaced name, e.g. `github.get_issue`. */
  name: string;
  /** The bare tool name as it will be shown, e.g. `get_issue`. */
  bare: string;
  /** The server id it belongs to. */
  server: string;
  /** The server name as written in the config. */
  serverName: string;
}

export interface RuleMatch {
  rule: Rule;
  reads: readonly ResourceShape[];
  writes: readonly ResourceShape[];
}

/**
 * First matching row wins. Matching is case-insensitive on both the full
 * namespaced name and the bare tool name; `serverAnyOf` rows additionally
 * require the server id or name to match; `veto` rows are skipped when a veto
 * substring is present.
 */
export function matchRule(facts: ToolFacts): RuleMatch {
  const names = [facts.name.toLowerCase(), facts.bare.toLowerCase()];
  const serverText = `${facts.server} ${facts.serverName}`.toLowerCase();

  for (const rule of RULES) {
    if (rule.fallback) return { rule, reads: rule.reads ?? [], writes: rule.writes ?? [] };
    if (rule.serverAnyOf && !rule.serverAnyOf.some((s) => serverText.includes(s))) continue;
    const nameHit =
      (rule.anyOf ?? []).some((s) => names.some((n) => n.includes(s))) ||
      (rule.patterns ?? []).some((p) => names.some((n) => new RegExp(p, "i").test(n)));
    if (!nameHit) continue;
    if (rule.veto && rule.veto.some((v) => names.some((n) => n.includes(v)))) continue;
    return { rule, reads: rule.reads ?? [], writes: rule.writes ?? [] };
  }

  // Unreachable while the fallback row is last; keep TypeScript honest.
  const last = RULES[RULES.length - 1];
  if (!last) throw new Error("rules table is empty");
  return { rule: last, reads: last.reads ?? [], writes: last.writes ?? [] };
}
