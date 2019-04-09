#! /usr/bin/env bash

set -o errtrace
set -o errexit
set -o pipefail

tempFile="/path/to/temp/files" ##### to be filled in per team #####

export REPLYTO="user@domain.com" ##### to be filled in per team #####

### Tool parameters ###

email=()

mandatory_email="" ##### to be filled in per team #####

branches=()

allbranches="false"
prodbranches="false"
skipClean="false"
verbose="false"
summaryOnly="false"

debugMode="false"

while [ "$1" != "" ]; do
	case "$1" in
		-e | --email )
			shift
			# append the email to the list
			email+=(`echo "$1" | tr ',' ' '`)
			;;
		-b | --branch )
			shift
			# append branch to the list
			branches+=(`echo "$1" | tr ',' ' '`)
			;;
		-a | --allbranches )
			allbranches="true"
			;;
		-p | --prodbranches )
			prodbranches="true"
			;;
		-c | --skipClean )
			skipClean="true"
			;;
		-s | --summary )
			summaryOnly="true"
			;;
		-v | --verbose )
			verbose="true"
			;;
		-d | --debug )
			set -x
			debugMode="true"
			;;
		-h | --help )
			echo "usage: bash alfred.sh [[[-e email ] [-a]] | [-h]]"
			echo "-e|--email [email]: List of email recipients to whom to send reports (separate list of emails with commas, no spaces)"
			echo "-b|--branch [branch name]: Specify branches to maintain (separate list of branches with commas, no spaces)"
			echo "-a|--allbranches: Update all branches (does nothing if specific branches are listed with -b)"
			echo "-p|--prodbranches: Update production branches (mandatory)"
			echo "-c|--skipclean: Skip cleaning branch before maintenance. Only choose one branch when using this option. WARNING: should only be done after resolving conflicts!"
			echo "-s|--summary: Only send summary report email, not the error emails"
			echo "-v|--verbose: Turn on verbose logging"
			echo "-d|--debug: Turn on extensive logging for debugging. *WARNING*, this will print out your username and password in the log! Emailing will be disabled"
			echo "-h|--help: This help info"
			exit
			;;
		* )
			echo "$1: Invalid parameter"
			exit 1
	esac
	shift
done

### Branch variables ###

if [[ "$prodbranches" = "false" ]]; then
	# Test branches:
	branchesPath="" ##### to be filled in by tester #####
	# trunk
	sourcePath="" ##### to be filled in by tester #####
	subDirectory=""
	email="user@domain.com" ##### to be filled in by tester #####
else
	# Production branches:
	branchesPath="" ##### to be filled in per team #####
	sourcePath="" # remote trunk, to be filled in per team
	subDirectory="" # country or other possible subdir, to be filled in per team
	email+=("$mandatory_email")
fi

### Logging variables ###

reportSummary=()
reportSummaryHeader=(
	"*********************************"
	"*   Branch maintenance summary  *"
	"*********************************"
	""
)
reportSummaryEnd="\n*********************************\n*********************************\n"
timestamp=$(date "+D%m-%d-%Y-T%H-%M-%S")
logsPath="/path/to/system/logs/alfred" ##### to be filled in per team #####

mkdir -p "$logsPath"

logFile="$logsPath/branchMaintLog-$timestamp.txt"
statusFile="$logsPath/temp-status-log.txt"

if [[ "${#branches[@]}" -eq 0 ]]; then
	if [ "$allbranches" = "true" ]; then
		branches="all branches"
	elif [[ "$xworks" = "true" || "$prodbranches" = "false" ]]; then
		for f in "$branchesPath"/*; do
			f="$( basename "$f" )" # we only want the name of the file itself.
			if [[ "$f" = xw* ]]; then
				branches+=("$f")
			fi
		done
	elif [ "$prodbranches" = "true" ]; then
		echo "Must specify branches to update using -a or -b; use -h for more info"
		exit 1
	fi
fi

### Logging ###

touch "$logFile"
touch "$statusFile"
exec 3>&1 4>&2
trap 'exec 2>&4 1>&3' 1 2 3
exec 1>"$logFile" 2>&1

# functions:

# $1: message, $2: email summary, $3: summary indicator
send_report() {
	emailSummary="none"
	if [[ "$summaryOnly" = "false" || "$3" = "summary" ]]; then emailSummary="$2"; fi

	echo -e "$1"
	# if debugmode is off and we're now adding in the report summary...
	if [[ "$debugMode" = "false" && "$emailSummary" != "none" ]]; then
		if [[ "$3" = "summary" ]]; then
			# print to statusFile for the web site
			summaryStr="<p class='text-color-blue'>\nBranch Maintenance Summary</p><hr>\n<p class='text-color-blue'>${reportSummary[@]}</p>\n<hr>"
			echo -e "$summaryStr" | "$tempFile"
			cat "$tempFile" >> "$statusFile"

			# print to logFile
			printf "%s\n" "${reportSummaryHeader[@]}" > "$tempFile"
			printf "%s\n" "${reportSummary[@]}" >> "$tempFile"
			echo -e "$reportSummaryEnd" "" >> "$tempFile"
			cat "$tempFile" >> "$logFile"
		fi
		cat "$logFile" | mail -s "$2" "${email[@]}"
	fi
}

# $1: message, $2: result
add_to_summary() {
	reportSummary+=("$1" "$2")
}

### Exec ###

echo -e "*** Branch maintenance tool running for: ${branches[@]} ***\n"
echo -e "<p>Branch maintenance now running for the following branches: ${branches[@]}</p>" > "$statusFile"
if [ "$verbose" = "true" ]; then echo -e "\nVerbose mode on"; fi

for i in "$branchesPath"/*; do
	i="$( basename "$i" )" # we only want the name of the file itself.

	# if we're not doing all branches and the current branch isn't in the branches list, then skip
	if [ "$allbranches" = "false" ]; then
		branchFound="false"
		for b in "${branches[@]}"; do
			if [[ "$b" = "$i" ]]; then
				# branch is listed, so stop searching and update branch
				branchFound="true"
				continue
			fi
		done
		# branch not found, so skip to next branch in folder
		if [ "$branchFound" = "false" ]; then
			continue
		fi
	fi

	echo -e "\n*** Starting maintenance for $i ***"
	echo -e "<p>Validating $i</p>" >> "$statusFile"

	stdErrEmailSubject="BRANCH MAINTENANCE ERROR on $i!"

	# Check if branch exists locally
	if [[ ! -d "$branchesPath/$i/$subDirectory" ]]; then
		logMessage="*** ERROR: $branchesPath/$i/$subDirectory doesn't exist! ***"
		add_to_summary "$i" "FAILED"
		send_report "$logMessage" "BRANCH MAINTENANCE ERROR: branch doesn't exist"
		echo -e "<p class='text-color-red'>ERROR: $branchesPath/$i/$subDirectory doesn't exist! Check the <a href='#' class='text-color-red' data-log-link='$logFile'>LOG FILE</a> for more info.</p>" >> "$statusFile"
		continue
	fi

	# Check if branch exists remotely and if diff exists
	if [[ "$prodbranches" = "true" ]] && ! svn ls "$BRANCH/$i"; then 
		logMessage="*** ERROR: $BRANCH/$i doesn't exist! Skipping maintenance on $i ***"
		add_to_summary "$i" "FAILED"
		send_report "$logMessage" "BRANCH MAINTENANCE ERROR: remote branch doesn't exist"
		echo -e "<p class='text-color-red'>ERROR: $BRANCH/$i doesn't exist! Check the <a href='#' class='text-color-red' data-log-link='$logFile'>LOG FILE</a> for more info.</p>" >> "$statusFile"
		continue
	else 
		# get list of revs on source that aren't on target and remove any *'d ones (these are prop changes for merges that didn't happen at branch root), then strip off the leading 'r'
		diffList=$(svn mergeinfo --show-revs eligible -R "$sourcePath" "$branchesPath/$i" | sed -e '/^r[0-9]\{1,9\}\*$/d' | cut -c2-)
		if [[ "${#diffList}" -gt 0 ]]; then
			echo -e "<p>Diff found between Trunk and $i. Starting maintenance.</p>" >> "$statusFile"
			echo -e "\n*** Diff found between Trunk and $i. Starting maintenance. ***"
		else
			logMessage="*** No diff found between Trunk and $i. Moving on. ***"
			add_to_summary "$i" "No Diffs"
			echo -e "<p>No diff found between Trunk and $i. Moving on.</p>" >> "$statusFile"
			continue
		fi
		# go into the subdirectory
		pushd "$branchesPath/$i/$subDirectory" &> /dev/null
	fi

	# Run clean
	if [ "$skipClean" = "false" ]; then
		echo -e "<p>Cleaning branch.</p>" >> "$statusFile"
		if ! clean; then
			logMessage="*** ERROR: Problem cleaning $i. Fix the issue, then reexecute. ***"
			add_to_summary "$i" "FAILED"
			send_report "$logMessage" "$stdErrEmailSubject"
			popd &> /dev/null # go back
			echo -e "<p class='text-color-red'>ERROR: Problem cleaning $i. Fix the issue in the terminal, and then start maintenance again. Check the <a href='#' class='text-color-red' data-log-link='$logFile'>LOG FILE</a> for more info.</p>" >> "$statusFile"
			continue
		else
			echo -e "<p>$i cleaned. Now running up.</p>" >> "$statusFile"
			echo -e "\n*** $i cleaned. Now running up. ***"
		fi
	else
		if [[ "${#branches[@]}" -eq 1 ]]; then
			echo -e "<p>Skipping clean. Now running up.</p>" >> "$statusFile"
			echo -e "\n*** Skipping clean. Now running up. ***"
		else
			logMessage="\n*** Too many branches specified! Only list one branch when cleaning. Alfred is quitting now. ***"
			send_report "$logMessage" "$stdErrEmailSubject"
			exit 1
		fi
	fi

	# Run svn up on branch
	if ! output=$(svn up "$branchesPath/$i/$subDirectory"); then
		logMessage="*** ERROR: Problem updating $i. Fix the issue, then reexecute. ***"
		add_to_summary "$i" "FAILED"
		send_report "$logMessage" "$stdErrEmailSubject"
		popd &> /dev/null # go back
		echo -e "<p class='text-color-red'>ERROR: Problem updating $i. Fix the issue in the terminal, and then start maintenance again. Check the <a href='#' class='text-color-red' data-log-link='$logFile'>LOG FILE</a> for more info.</p>" >> "$statusFile"
		continue
	else
		while read -r line; do
			if [ "$verbose" = "true" ]; then echo "$line"; fi
		done <<< "$output"
		echo -e "<p>$i updated. Now merging in Trunk.</p>" >> "$statusFile"
		echo -e "\n*** $i updated. Now merging in Trunk. ***"
	fi

	# Try to merge trunk into branch
	conflicts="false"
	if ! output=$(svn merge "$sourcePath/$subDirectory" --accept postpone); then
		logMessage="*** ERROR: Merge failed. Fix the issue, then reexecute. ***"
		echo -e "<p class='text-color-red'>ERROR: Merge failed. Fix the issue in the terminal, and then start maintenance again. Check the <a href='#' class='text-color-red' data-log-link='$logFile'>LOG FILE</a> for more info.</p>" >> "$statusFile"
		add_to_summary "$i" "FAILED"
		send_report "$logMessage" "$stdErrEmailSubject"
		popd &> /dev/null # go back
		continue
	else
		while read -r line; do
			if [ "$verbose" = "true" ]; then echo "$line"; fi
			if [[ "$line" = *"Summary of conflicts"* ]]; then conflicts="true"; fi
		done <<< "$output"
	fi

	# Report conflicts if they exist
	if [ "$conflicts" = "true" ]; then
		logMessage="*** ERROR: Conflicts found. Resolve, then reexecute. ***"
		echo -e "<p class='text-color-red'>ERROR: Conflicts found. Fix the issue in the terminal, and then start maintenance again. Check the <a href='#' class='text-color-red' data-log-link='$logFile'>LOG FILE</a> for more info.</p>" >> "$statusFile"
		add_to_summary "$i" "FAILED"
		send_report "$logMessage" "$stdErrEmailSubject"
		popd &> /dev/null # go back
		continue
	else
		echo -e "<p>Merge completed with no conflicts. Now committing.</p>" >> "$statusFile"
		echo -e "\n*** Finished merging with no conflicts. Now committing. ***"
	fi

	# Commit changes
	if ! output=$(REV=$( svn info | grep "Revision: " | sed "s/Revision: //" ) && svn ci -m "Merged trunk into $branchesPath/$i/?p=$REV"); then
		logMessage="*** Commit failed. Fix the issue, then reexecute. ***"
		echo -e "<p class='text-color-red'>ERROR: Commit failed. Fix the issue in the terminal, and then start maintenance again. Check the <a href='#' class='text-color-red' data-log-link='$logFile'>LOG FILE</a> for more info.</p>" >> "$statusFile"
		add_to_summary "$i" "FAILED"
		send_report "$logMessage" "$stdErrEmailSubject"
	else
		while read -r line; do
			if [ "$verbose" = "true" ]; then 
				echo "$line"; 
			else
				if [[ "$line" == *"Committed revision"* ]]; then revision="$line"; fi
			fi
		done <<< "$output"
		add_to_summary "$i" "Success"
		echo -e "<p class='text-color-blue'>$revision $i is now up to date with Trunk.</p>" >> "$statusFile"
		echo -e "\n$revision\n*** MERGE COMMITTED SUCCESSFULLY! $i is up to date with Trunk. ***"
	fi

	popd &> /dev/null # go back
done

branchList=${branches[@]}
logMessage="\n*** Maintenance finished! Branches processed: $branchList ***"
echo -e "<p class='text-color-blue'>Branch maintenance finished!</p>" >> "$statusFile"
send_report "$logMessage" "Branch maintenance finished for $branchList" "summary"
