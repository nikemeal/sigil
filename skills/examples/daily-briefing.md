# Daily Briefing

Use this skill when giving a morning briefing or daily summary. This is designed to
pair with the scheduler — set up a recurring job to deliver this automatically.

## What to include

- **Weather** — current conditions and forecast for the user's location. Use
  `curl -s "https://wttr.in/{location}?format=j1"` to fetch weather data.
  Include temperature, conditions, and whether rain/snow is expected.
- **Pending tasks** — check for any active background tasks and their progress.
  Mention anything that completed overnight or needs attention.
- **Reminders** — recall any stored reminders or follow-ups due today.
  Use the memory system to check for time-sensitive notes.
- **Calendar** — if the user has shared calendar context, summarise today's
  events with times. Flag any conflicts or back-to-back meetings.

## Format

Keep it scannable. Use short bullet points, not paragraphs. Lead with the most
important items. The whole briefing should be readable in under 30 seconds.

Example:

> **Morning — Tuesday 15 Apr**
> - 14C, cloudy, rain expected after 2pm
> - 3 meetings today (standup 9:30, 1:1 with Alex 11:00, retro 3:00)
> - Reminder: dentist appointment tomorrow at 10am
> - Task "research flight prices" completed overnight — results ready

## Scheduling example

To set this up as a recurring job, add to `sigil.toml`:

```toml
[[jobs]]
id = "morning-brief"
cron = "0 8 * * 1-5"
prompt = "Give me my daily briefing."
transport = "telegram"
```

Or ask the agent: *"Send me a daily briefing every weekday at 8am on Telegram."*
