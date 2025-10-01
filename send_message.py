from linebot import LineBotApi
from linebot.models import TextSendMessage
import os

# Renderの環境変数から取得するのが安全
LINE_CHANNEL_ACCESS_TOKEN = os.environ['LINE_CHANNEL_ACCESS_TOKEN']
USER_ID = os.environ['LINE_USER_ID']

line_bot_api = LineBotApi(LINE_CHANNEL_ACCESS_TOKEN)

def main():
    message = TextSendMessage(text="おはようございます！")
    line_bot_api.push_message(USER_ID, message)

if __name__ == "__main__":
    main()
