# =========== Copyright 2023 @ CAMEL-AI.org. All Rights Reserved. ===========
# Licensed under the Apache License, Version 2.0 (the “License”);
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an “AS IS” BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# =========== Copyright 2023 @ CAMEL-AI.org. All Rights Reserved. ===========
from enum import Enum


class ActionType(Enum):
    EXIT = "exit"
    REFRESH = "refresh"
    SEARCH_USER = "search_user"
    SEARCH_POSTS = "search_posts"
    CREATE_POST = "create_post"
    LIKE_POST = "like_post"
    UNLIKE_POST = "unlike_post"
    DISLIKE_POST = "dislike_post"
    UNDO_DISLIKE_POST = "undo_dislike_post"
    REPORT_POST = "report_post"
    FOLLOW = "follow"
    UNFOLLOW = "unfollow"
    MUTE = "mute"
    UNMUTE = "unmute"
    TREND = "trend"
    SIGNUP = "sign_up"
    REPOST = "repost"
    QUOTE_POST = "quote_post"
    UPDATE_REC_TABLE = "update_rec_table"
    CREATE_COMMENT = "create_comment"
    LIKE_COMMENT = "like_comment"
    UNLIKE_COMMENT = "unlike_comment"
    DISLIKE_COMMENT = "dislike_comment"
    UNDO_DISLIKE_COMMENT = "undo_dislike_comment"
    DO_NOTHING = "do_nothing"
    PURCHASE_PRODUCT = "purchase_product"
    INTERVIEW = "interview"
    JOIN_GROUP = "join_group"
    LEAVE_GROUP = "leave_group"
    SEND_TO_GROUP = "send_to_group"
    CREATE_GROUP = "create_group"
    LISTEN_FROM_GROUP = "listen_from_group"

    @classmethod
    def get_default_facebook_actions(cls):
        # Facebook Groups: no public dislike (reactions default positive),
        # REPORT_POST for rule violations, no QUOTE_POST (groups don't quote).
        return [
            cls.CREATE_POST,
            cls.CREATE_COMMENT,
            cls.LIKE_POST,
            cls.LIKE_COMMENT,
            cls.REPOST,
            cls.SEARCH_POSTS,
            cls.SEARCH_USER,
            cls.TREND,
            cls.REFRESH,
            cls.DO_NOTHING,
            cls.FOLLOW,
            cls.MUTE,
            cls.REPORT_POST,
        ]

    @classmethod
    def get_default_threads_actions(cls):
        # Threads: closest to Twitter (no dislike, no group-chat actions),
        # but real threaded replies (CREATE_COMMENT/LIKE_COMMENT) are the
        # platform's defining mechanic — Twitter's own preset here has no
        # comment action at all, just posts/quotes.
        return [
            cls.CREATE_POST,
            cls.CREATE_COMMENT,
            cls.LIKE_POST,
            cls.LIKE_COMMENT,
            cls.REPOST,
            cls.QUOTE_POST,
            cls.FOLLOW,
            cls.MUTE,
            cls.REPORT_POST,
            cls.DO_NOTHING,
        ]

    @classmethod
    def get_default_tiktok_actions(cls):
        # TikTok: no dislike, no quote/duet (v1 — a stretch feature since it's
        # cosmetically a re-creation, not a real video re-mix here). CREATE_POST
        # stands in for posting a video (caption/description, not real video);
        # CREATE_COMMENT is the real high-volume payload, not a secondary action.
        return [
            cls.CREATE_POST,
            cls.CREATE_COMMENT,
            cls.LIKE_POST,
            cls.LIKE_COMMENT,
            cls.REPOST,
            cls.FOLLOW,
            cls.MUTE,
            cls.REPORT_POST,
            cls.DO_NOTHING,
        ]


class RecsysType(Enum):
    TWITTER = "twitter"
    TWHIN = "twhin-bert"
    REDDIT = "reddit"
    RANDOM = "random"


class DefaultPlatformType(Enum):
    FACEBOOK = "facebook"
    THREADS = "threads"
    TIKTOK = "tiktok"
