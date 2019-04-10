# Alfred
Tool for automating svn branch maintenance.

For terminal help run `alfred-server -h`

## Running from the web page

To run in the web server:

1. Type alfred-server from terminal
2. Open http://localhost:3000/

Maintenance will be run on whatever branches you select, and then error and summary reports will be emailed to the recipients you specify.  Before maintenance is run, branches are cleaned and up'd.
* To specify individual branches, check the branches box and check the boxes next to the branches to update.
* To skip running "clean" on a branch before maintenance, check the box "Don't clean branch". Only one branch may be maintained if clean is skipped. **WARNING:** only use this option after resolving conflicts!
* To run maintenance on all locally checked out branches, check the all branches box.
* To specify email recipients, check the emails box and list emails separated by commas (but no spaces).
* To skip sending error reports and only send the final summary report, check the summary report box.
* To see all svn messages in the logs and email reports, check the verbose mode checkbox (won't change what's displayed in the Results panel).
* To schedule a repeating maintenance, check the scheduling option and set the schedule. Unchecking the option will stop future iterations but not a currently running maintenance. Once Start is clicked, the server will keep track of the schedule, so the browser may be closed without interrupting the schedule (however, if the computer is put to sleep and not woken until after the scheduled hour and date, maintenance will not occur for that time, but the schedule will continue). One caveat - if a different browser is opened instead, maintenance will still occur, but the schedule announcement that normally happens after reopening/reloading the page will not be shown.

After clicking Start, the maintenance log will be shown in the Results box and emails will be sent out. Regardless of what emails you specify (or not), reports will always be sent to team lead.

To cancel future maintenance after you've already clicked Start, click Cancel Schedule. This will only cancel the repeating schedule, not any currently running maintenance.

## Running from the terminal

To run in the terminal:

```bash
alfred-server [[-e|--email {email address}]
    		[-p|--prodbranches][-b|--branch {branch name}][-a|--allbranches]
    		[-c|--skipClean]
    		[-s|--summary][-v|--verbose][-d|--debug]
    		[-h|--help]]
```

**Note:** The -p flag is mandatory (without it, the script will try to update test branches only set up on my machine).

In addition to -p, you must also specify which branches to update using -a or -b. The script will clean, update, and merge trunk into those branches and then send reports to specified email recipients.
* To run on all branches, pass in "-a".
* To run on specific branches, pass in "-b" and a comma separated list of the branches, liks this:

```bash
alfred-server -b branch1,branch2,branch3
```

The -b flag invalidates passing in -a.

* To skip running "clean" on a branch before maintenance, pass in "-c".

**WARNING:** Only one branch may be maintained if clean is skipped. Only use this option after resolving conflicts!

All steps are logged, and if any errors occur, an email is sent to the email recipients, and then the script continues to the next branch.
* To send error reports to specific people, add "-e" and a comma separated (no spaces) list of email address, like this:

```bash
alfred-server -e test1@domain.com,test2@domain.com,test3@domain.com
```

* To skip sending error reports and only send the final summary report, pass in "-s".

Log files are saved in /Users/[your name]/path/to/logs/alfred and are named with a timestamp with this format: D(mon)-(date)-(year)-T(hour)-(min)-(sec).
* For verbose svn logging, with all merge and commit messages, pass in "-v".

* If debug flag "-d" is passed, extensive bash logging will be turned on and emailing turned off.  **WARNING**: your username and password will be printed in the logs!

