export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ab_config: {
        Row: {
          brand_context: string
          id: number
          min_days: number
          min_visitors: number
          updated_at: string
        }
        Insert: {
          brand_context?: string
          id?: number
          min_days?: number
          min_visitors?: number
          updated_at?: string
        }
        Update: {
          brand_context?: string
          id?: number
          min_days?: number
          min_visitors?: number
          updated_at?: string
        }
        Relationships: []
      }
      ab_events: {
        Row: {
          device_type: string | null
          dwell_ms: number | null
          element_id: string | null
          event_type: string
          id: string
          referrer: string | null
          section_name: string | null
          session_id: string
          timestamp: string
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          value: number | null
          variant_id: string
        }
        Insert: {
          device_type?: string | null
          dwell_ms?: number | null
          element_id?: string | null
          event_type: string
          id?: string
          referrer?: string | null
          section_name?: string | null
          session_id: string
          timestamp?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          value?: number | null
          variant_id: string
        }
        Update: {
          device_type?: string | null
          dwell_ms?: number | null
          element_id?: string | null
          event_type?: string
          id?: string
          referrer?: string | null
          section_name?: string | null
          session_id?: string
          timestamp?: string
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          value?: number | null
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ab_events_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "ab_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ab_tests: {
        Row: {
          ended_at: string | null
          id: string
          min_days: number
          min_visitors: number
          started_at: string
          status: string
          variant_a_id: string | null
          variant_b_id: string | null
          winner_variant: string | null
        }
        Insert: {
          ended_at?: string | null
          id?: string
          min_days?: number
          min_visitors?: number
          started_at?: string
          status?: string
          variant_a_id?: string | null
          variant_b_id?: string | null
          winner_variant?: string | null
        }
        Update: {
          ended_at?: string | null
          id?: string
          min_days?: number
          min_visitors?: number
          started_at?: string
          status?: string
          variant_a_id?: string | null
          variant_b_id?: string | null
          winner_variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_variant_a"
            columns: ["variant_a_id"]
            isOneToOne: false
            referencedRelation: "ab_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_variant_b"
            columns: ["variant_b_id"]
            isOneToOne: false
            referencedRelation: "ab_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      ab_variants: {
        Row: {
          ai_reasoning: string
          carried_from_variant_id: string | null
          config: Json
          conversion_rate: number
          generation: number
          id: string
          signup_count: number
          slot: string
          test_id: string | null
          visitor_count: number
        }
        Insert: {
          ai_reasoning?: string
          carried_from_variant_id?: string | null
          config?: Json
          conversion_rate?: number
          generation?: number
          id?: string
          signup_count?: number
          slot: string
          test_id?: string | null
          visitor_count?: number
        }
        Update: {
          ai_reasoning?: string
          carried_from_variant_id?: string | null
          config?: Json
          conversion_rate?: number
          generation?: number
          id?: string
          signup_count?: number
          slot?: string
          test_id?: string | null
          visitor_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ab_variants_carried_from_variant_id_fkey"
            columns: ["carried_from_variant_id"]
            isOneToOne: false
            referencedRelation: "ab_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ab_variants_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "ab_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      accept_estimate_to_job_requests: {
        Row: {
          company_id: string
          created_at: string
          created_by: string
          error_code: string | null
          estimate_id: string
          id: string
          idempotency_key: string
          response: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by: string
          error_code?: string | null
          estimate_id: string
          id?: string
          idempotency_key: string
          response?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string
          error_code?: string | null
          estimate_id?: string
          id?: string
          idempotency_key?: string
          response?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accept_estimate_to_job_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accept_estimate_to_job_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accept_estimate_to_job_requests_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_category_mappings: {
        Row: {
          company_id: string
          created_at: string | null
          expense_category_id: string
          external_account_id: string
          external_account_name: string | null
          id: string
          provider: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          expense_category_id: string
          external_account_id: string
          external_account_name?: string | null
          id?: string
          provider: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          expense_category_id?: string
          external_account_id?: string
          external_account_name?: string | null
          id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_category_mappings_expense_category_id_fkey"
            columns: ["expense_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_connections: {
        Row: {
          access_token: string | null
          company_id: string
          created_at: string
          id: string
          is_connected: boolean
          last_sync_at: string | null
          propagate_deletes: boolean
          provider: string
          provider_environment: string
          realm_id: string | null
          realm_id_lookup: string | null
          refresh_token: string | null
          sync_direction: string
          sync_enabled: boolean
          token_expires_at: string | null
          updated_at: string
          webhook_verifier_token: string | null
        }
        Insert: {
          access_token?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_connected?: boolean
          last_sync_at?: string | null
          propagate_deletes?: boolean
          provider: string
          provider_environment?: string
          realm_id?: string | null
          realm_id_lookup?: string | null
          refresh_token?: string | null
          sync_direction?: string
          sync_enabled?: boolean
          token_expires_at?: string | null
          updated_at?: string
          webhook_verifier_token?: string | null
        }
        Update: {
          access_token?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_connected?: boolean
          last_sync_at?: string | null
          propagate_deletes?: boolean
          provider?: string
          provider_environment?: string
          realm_id?: string | null
          realm_id_lookup?: string | null
          refresh_token?: string | null
          sync_direction?: string
          sync_enabled?: boolean
          token_expires_at?: string | null
          updated_at?: string
          webhook_verifier_token?: string | null
        }
        Relationships: []
      }
      accounting_sync_log: {
        Row: {
          company_id: string
          created_at: string
          details: string | null
          direction: string
          entity_id: string | null
          entity_type: string
          external_id: string | null
          id: string
          provider: string
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          details?: string | null
          direction: string
          entity_id?: string | null
          entity_type: string
          external_id?: string | null
          id?: string
          provider: string
          status: string
        }
        Update: {
          company_id?: string
          created_at?: string
          details?: string | null
          direction?: string
          entity_id?: string | null
          entity_type?: string
          external_id?: string | null
          id?: string
          provider?: string
          status?: string
        }
        Relationships: []
      }
      activities: {
        Row: {
          attachment_count: number
          attachment_ids: string[] | null
          attachments: string[] | null
          body_text: string | null
          body_text_clean: string | null
          cc_emails: string[] | null
          classified_at: string | null
          classifier_version: string | null
          client_id: string | null
          company_id: string
          content: string | null
          created_at: string
          created_by: string | null
          direction: string | null
          draft_history_id: string | null
          duration_minutes: number | null
          email_connection_id: string | null
          email_message_id: string | null
          email_thread_id: string | null
          estimate_id: string | null
          from_email: string | null
          has_attachments: boolean
          id: string
          invoice_id: string | null
          is_read: boolean
          match_confidence: string | null
          match_needs_review: boolean
          opportunity_id: string | null
          outcome: string | null
          project_id: string | null
          provider_mutations_disabled: boolean
          sent_by_agent: boolean
          site_visit_id: string | null
          subject: string
          suggested_client_id: string | null
          to_emails: string[] | null
          type: string
        }
        Insert: {
          attachment_count?: number
          attachment_ids?: string[] | null
          attachments?: string[] | null
          body_text?: string | null
          body_text_clean?: string | null
          cc_emails?: string[] | null
          classified_at?: string | null
          classifier_version?: string | null
          client_id?: string | null
          company_id: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          draft_history_id?: string | null
          duration_minutes?: number | null
          email_connection_id?: string | null
          email_message_id?: string | null
          email_thread_id?: string | null
          estimate_id?: string | null
          from_email?: string | null
          has_attachments?: boolean
          id?: string
          invoice_id?: string | null
          is_read?: boolean
          match_confidence?: string | null
          match_needs_review?: boolean
          opportunity_id?: string | null
          outcome?: string | null
          project_id?: string | null
          provider_mutations_disabled?: boolean
          sent_by_agent?: boolean
          site_visit_id?: string | null
          subject: string
          suggested_client_id?: string | null
          to_emails?: string[] | null
          type: string
        }
        Update: {
          attachment_count?: number
          attachment_ids?: string[] | null
          attachments?: string[] | null
          body_text?: string | null
          body_text_clean?: string | null
          cc_emails?: string[] | null
          classified_at?: string | null
          classifier_version?: string | null
          client_id?: string | null
          company_id?: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          draft_history_id?: string | null
          duration_minutes?: number | null
          email_connection_id?: string | null
          email_message_id?: string | null
          email_thread_id?: string | null
          estimate_id?: string | null
          from_email?: string | null
          has_attachments?: boolean
          id?: string
          invoice_id?: string | null
          is_read?: boolean
          match_confidence?: string | null
          match_needs_review?: boolean
          opportunity_id?: string | null
          outcome?: string | null
          project_id?: string | null
          provider_mutations_disabled?: boolean
          sent_by_agent?: boolean
          site_visit_id?: string | null
          subject?: string
          suggested_client_id?: string | null
          to_emails?: string[] | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_email_connection_id_fkey"
            columns: ["email_connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_draft_history_id_fkey"
            columns: ["draft_history_id"]
            isOneToOne: false
            referencedRelation: "ai_draft_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_activities_site_visit"
            columns: ["site_visit_id"]
            isOneToOne: false
            referencedRelation: "site_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_comments: {
        Row: {
          activity_id: string
          company_id: string
          content: string
          created_at: string | null
          deleted_at: string | null
          id: string
          is_client_visible: boolean
          updated_at: string | null
          user_id: string
        }
        Insert: {
          activity_id: string
          company_id: string
          content: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_client_visible?: boolean
          updated_at?: string | null
          user_id: string
        }
        Update: {
          activity_id?: string
          company_id?: string
          content?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_client_visible?: boolean
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_comments_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_briefings: {
        Row: {
          ab_test_proposals: Json | null
          action_items: Json | null
          ad_suggestions: Json | null
          competitor_intel: Json | null
          created_at: string
          email_sent: boolean
          error: string | null
          id: string
          insights: Json | null
          keyword_recs: Json | null
          market_sentiment: Json | null
          performance_data: Json | null
          period_end: string
          period_start: string
          progress: Json | null
          status: string
          summary: string | null
          triggered_by: string
        }
        Insert: {
          ab_test_proposals?: Json | null
          action_items?: Json | null
          ad_suggestions?: Json | null
          competitor_intel?: Json | null
          created_at?: string
          email_sent?: boolean
          error?: string | null
          id?: string
          insights?: Json | null
          keyword_recs?: Json | null
          market_sentiment?: Json | null
          performance_data?: Json | null
          period_end: string
          period_start: string
          progress?: Json | null
          status?: string
          summary?: string | null
          triggered_by?: string
        }
        Update: {
          ab_test_proposals?: Json | null
          action_items?: Json | null
          ad_suggestions?: Json | null
          competitor_intel?: Json | null
          created_at?: string
          email_sent?: boolean
          error?: string | null
          id?: string
          insights?: Json | null
          keyword_recs?: Json | null
          market_sentiment?: Json | null
          performance_data?: Json | null
          period_end?: string
          period_start?: string
          progress?: Json | null
          status?: string
          summary?: string | null
          triggered_by?: string
        }
        Relationships: []
      }
      ad_spend_log: {
        Row: {
          channel: string
          clicks: number | null
          created_at: string
          downloads: number | null
          entered_by: string | null
          id: string
          impressions: number | null
          source: string
          spend_cents: number
          spend_date: string
        }
        Insert: {
          channel: string
          clicks?: number | null
          created_at?: string
          downloads?: number | null
          entered_by?: string | null
          id?: string
          impressions?: number | null
          source: string
          spend_cents: number
          spend_date: string
        }
        Update: {
          channel?: string
          clicks?: number | null
          created_at?: string
          downloads?: number | null
          entered_by?: string | null
          id?: string
          impressions?: number | null
          source?: string
          spend_cents?: number
          spend_date?: string
        }
        Relationships: []
      }
      admin_feature_overrides: {
        Row: {
          company_id: string
          enabled: boolean
          enabled_at: string | null
          enabled_by: string | null
          feature_key: string
          id: string
          metadata: Json | null
        }
        Insert: {
          company_id: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature_key: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          company_id?: string
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          feature_key?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      admins: {
        Row: {
          created_at: string | null
          email: string
          id: string
          name: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          name?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          name?: string | null
        }
        Relationships: []
      }
      ads_daily_account: {
        Row: {
          clicks: number
          conversions: number
          cpa: number
          ctr: number
          date: string
          impressions: number
          spend: number
          synced_at: string
        }
        Insert: {
          clicks?: number
          conversions?: number
          cpa?: number
          ctr?: number
          date: string
          impressions?: number
          spend?: number
          synced_at?: string
        }
        Update: {
          clicks?: number
          conversions?: number
          cpa?: number
          ctr?: number
          date?: string
          impressions?: number
          spend?: number
          synced_at?: string
        }
        Relationships: []
      }
      ads_daily_campaign: {
        Row: {
          campaign_name: string
          campaign_status: string
          clicks: number
          conversions: number
          cpa: number
          ctr: number
          date: string
          impressions: number
          spend: number
          synced_at: string
        }
        Insert: {
          campaign_name: string
          campaign_status?: string
          clicks?: number
          conversions?: number
          cpa?: number
          ctr?: number
          date: string
          impressions?: number
          spend?: number
          synced_at?: string
        }
        Update: {
          campaign_name?: string
          campaign_status?: string
          clicks?: number
          conversions?: number
          cpa?: number
          ctr?: number
          date?: string
          impressions?: number
          spend?: number
          synced_at?: string
        }
        Relationships: []
      }
      ads_daily_keyword: {
        Row: {
          clicks: number
          conversions: number
          date: string
          impressions: number
          keyword: string
          match_type: string
          quality_score: number | null
          spend: number
          synced_at: string
        }
        Insert: {
          clicks?: number
          conversions?: number
          date: string
          impressions?: number
          keyword: string
          match_type?: string
          quality_score?: number | null
          spend?: number
          synced_at?: string
        }
        Update: {
          clicks?: number
          conversions?: number
          date?: string
          impressions?: number
          keyword?: string
          match_type?: string
          quality_score?: number | null
          spend?: number
          synced_at?: string
        }
        Relationships: []
      }
      ads_sync_status: {
        Row: {
          backfill_progress: Json | null
          error: string | null
          id: string
          last_synced_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          backfill_progress?: Json | null
          error?: string | null
          id: string
          last_synced_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          backfill_progress?: Json | null
          error?: string | null
          id?: string
          last_synced_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      agent_actions: {
        Row: {
          action_data: Json
          action_type: string
          auto_execute_at: string | null
          company_id: string
          confidence: number
          context_source: string | null
          context_summary: string
          created_at: string
          error: string | null
          executed_at: string | null
          execution_result: Json | null
          expires_at: string | null
          id: string
          priority: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_data: Json
          action_type: string
          auto_execute_at?: string | null
          company_id: string
          confidence?: number
          context_source?: string | null
          context_summary: string
          created_at?: string
          error?: string | null
          executed_at?: string | null
          execution_result?: Json | null
          expires_at?: string | null
          id?: string
          priority?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_data?: Json
          action_type?: string
          auto_execute_at?: string | null
          company_id?: string
          confidence?: number
          context_source?: string | null
          context_summary?: string
          created_at?: string
          error?: string | null
          executed_at?: string | null
          execution_result?: Json | null
          expires_at?: string | null
          id?: string
          priority?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_knowledge_graph: {
        Row: {
          company_id: string
          confidence: number
          created_at: string
          id: string
          link_type: string | null
          object_id: string | null
          object_type: string | null
          predicate: string
          properties: Json | null
          source_entity_id: string | null
          subject_id: string | null
          subject_type: string | null
          target_entity_id: string | null
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          company_id: string
          confidence?: number
          created_at?: string
          id?: string
          link_type?: string | null
          object_id?: string | null
          object_type?: string | null
          predicate: string
          properties?: Json | null
          source_entity_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
          target_entity_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          company_id?: string
          confidence?: number
          created_at?: string
          id?: string
          link_type?: string | null
          object_id?: string | null
          object_type?: string | null
          predicate?: string
          properties?: Json | null
          source_entity_id?: string | null
          subject_id?: string | null
          subject_type?: string | null
          target_entity_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_knowledge_graph_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_knowledge_graph_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "graph_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_knowledge_graph_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "graph_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memories: {
        Row: {
          access_count: number
          category: string
          company_id: string
          confidence: number
          content: string
          created_at: string
          decay_score: number
          due_date: string | null
          embedding: string | null
          entity_id: string | null
          id: string
          last_accessed_at: string | null
          memory_type: string
          resolved_at: string | null
          source: string
          source_id: string | null
          updated_at: string
          user_id: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          access_count?: number
          category: string
          company_id: string
          confidence?: number
          content: string
          created_at?: string
          decay_score?: number
          due_date?: string | null
          embedding?: string | null
          entity_id?: string | null
          id?: string
          last_accessed_at?: string | null
          memory_type?: string
          resolved_at?: string | null
          source?: string
          source_id?: string | null
          updated_at?: string
          user_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          access_count?: number
          category?: string
          company_id?: string
          confidence?: number
          content?: string
          created_at?: string
          decay_score?: number
          due_date?: string | null
          embedding?: string | null
          entity_id?: string | null
          id?: string
          last_accessed_at?: string | null
          memory_type?: string
          resolved_at?: string | null
          source?: string
          source_id?: string | null
          updated_at?: string
          user_id?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_memories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_memories_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "graph_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_writing_profiles: {
        Row: {
          avg_sentence_length: number | null
          closing_patterns: string[] | null
          company_id: string
          created_at: string
          emails_analyzed: number
          formality_score: number | null
          greeting_patterns: string[] | null
          id: string
          profile_type: string
          subject_preferences: Json
          tone_traits: Json | null
          updated_at: string
          user_id: string
          vocabulary_preferences: Json | null
        }
        Insert: {
          avg_sentence_length?: number | null
          closing_patterns?: string[] | null
          company_id: string
          created_at?: string
          emails_analyzed?: number
          formality_score?: number | null
          greeting_patterns?: string[] | null
          id?: string
          profile_type?: string
          subject_preferences?: Json
          tone_traits?: Json | null
          updated_at?: string
          user_id: string
          vocabulary_preferences?: Json | null
        }
        Update: {
          avg_sentence_length?: number | null
          closing_patterns?: string[] | null
          company_id?: string
          created_at?: string
          emails_analyzed?: number
          formality_score?: number | null
          greeting_patterns?: string[] | null
          id?: string
          profile_type?: string
          subject_preferences?: Json
          tone_traits?: Json | null
          updated_at?: string
          user_id?: string
          vocabulary_preferences?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_writing_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_draft_history: {
        Row: {
          changes_made: Json | null
          company_id: string
          connection_id: string | null
          created_at: string
          discarded_at: string | null
          edit_distance: number | null
          edited_at: string | null
          final_version: string | null
          id: string
          mailbox_draft_id: string | null
          opportunity_id: string | null
          origin: string | null
          original_draft: string
          profile_type: string
          sent_at: string | null
          sent_provider_message_id: string | null
          sent_without_changes: boolean | null
          source_message_id: string | null
          status: string
          subject: string | null
          subject_source: string | null
          thread_id: string | null
          user_id: string
        }
        Insert: {
          changes_made?: Json | null
          company_id: string
          connection_id?: string | null
          created_at?: string
          discarded_at?: string | null
          edit_distance?: number | null
          edited_at?: string | null
          final_version?: string | null
          id?: string
          mailbox_draft_id?: string | null
          opportunity_id?: string | null
          origin?: string | null
          original_draft: string
          profile_type?: string
          sent_at?: string | null
          sent_provider_message_id?: string | null
          sent_without_changes?: boolean | null
          source_message_id?: string | null
          status?: string
          subject?: string | null
          subject_source?: string | null
          thread_id?: string | null
          user_id: string
        }
        Update: {
          changes_made?: Json | null
          company_id?: string
          connection_id?: string | null
          created_at?: string
          discarded_at?: string | null
          edit_distance?: number | null
          edited_at?: string | null
          final_version?: string | null
          id?: string
          mailbox_draft_id?: string | null
          opportunity_id?: string | null
          origin?: string | null
          original_draft?: string
          profile_type?: string
          sent_at?: string | null
          sent_provider_message_id?: string | null
          sent_without_changes?: boolean | null
          source_message_id?: string | null
          status?: string
          subject?: string | null
          subject_source?: string | null
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_draft_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_draft_history_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_draft_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_events: {
        Row: {
          app_version: string | null
          company_id: string | null
          created_at: string
          device_type: string | null
          duration_ms: number | null
          event_name: string
          event_type: string
          id: string
          os_version: string | null
          plan: string | null
          platform: string
          properties: Json | null
          role: string | null
          session_id: string
          user_id: string | null
        }
        Insert: {
          app_version?: string | null
          company_id?: string | null
          created_at?: string
          device_type?: string | null
          duration_ms?: number | null
          event_name: string
          event_type: string
          id?: string
          os_version?: string | null
          plan?: string | null
          platform: string
          properties?: Json | null
          role?: string | null
          session_id: string
          user_id?: string | null
        }
        Update: {
          app_version?: string | null
          company_id?: string | null
          created_at?: string
          device_type?: string | null
          duration_ms?: number | null
          event_name?: string
          event_type?: string
          id?: string
          os_version?: string | null
          plan?: string | null
          platform?: string
          properties?: Json | null
          role?: string | null
          session_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_events: {
        Row: {
          company_id: string | null
          created_at: string
          device_type: string | null
          dwell_ms: number | null
          element_id: string | null
          event_type: string
          feature_name: string | null
          id: string
          metadata: Json | null
          page_name: string | null
          session_id: string
          timestamp: string
          user_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          device_type?: string | null
          dwell_ms?: number | null
          element_id?: string | null
          event_type: string
          feature_name?: string | null
          id?: string
          metadata?: Json | null
          page_name?: string | null
          session_id: string
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          device_type?: string | null
          dwell_ms?: number | null
          element_id?: string | null
          event_type?: string
          feature_name?: string | null
          id?: string
          metadata?: Json | null
          page_name?: string | null
          session_id?: string
          timestamp?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_messages: {
        Row: {
          body: string | null
          created_at: string | null
          end_date: string | null
          id: string
          is_active: boolean | null
          start_date: string | null
          target_role: string | null
          title: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          end_date?: string | null
          id: string
          is_active?: boolean | null
          start_date?: string | null
          target_role?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_active?: boolean | null
          start_date?: string | null
          target_role?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      archetype_profiles: {
        Row: {
          blind_spots: string[]
          compatible_with: string[]
          created_at: string
          description_template: string
          growth_actions: string[]
          id: string
          ideal_scores: Json
          name: string
          red_flags: Json
          strengths: string[]
          tagline: string
          tension_with: string[]
        }
        Insert: {
          blind_spots?: string[]
          compatible_with?: string[]
          created_at?: string
          description_template: string
          growth_actions?: string[]
          id: string
          ideal_scores: Json
          name: string
          red_flags?: Json
          strengths?: string[]
          tagline: string
          tension_with?: string[]
        }
        Update: {
          blind_spots?: string[]
          compatible_with?: string[]
          created_at?: string
          description_template?: string
          growth_actions?: string[]
          id?: string
          ideal_scores?: Json
          name?: string
          red_flags?: Json
          strengths?: string[]
          tagline?: string
          tension_with?: string[]
        }
        Relationships: []
      }
      assessment_responses: {
        Row: {
          answer_value: Json
          answered_at: string
          chunk_number: number
          dimension_target: string
          id: string
          question_id: string
          question_text: string
          question_type: string
          response_time_ms: number | null
          secondary_dimension_target: string | null
          session_id: string
        }
        Insert: {
          answer_value: Json
          answered_at?: string
          chunk_number: number
          dimension_target: string
          id?: string
          question_id: string
          question_text: string
          question_type: string
          response_time_ms?: number | null
          secondary_dimension_target?: string | null
          session_id: string
        }
        Update: {
          answer_value?: Json
          answered_at?: string
          chunk_number?: number
          dimension_target?: string
          id?: string
          question_id?: string
          question_text?: string
          question_type?: string
          response_time_ms?: number | null
          secondary_dimension_target?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "question_pool"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_responses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "assessment_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_sessions: {
        Row: {
          ai_analysis: Json | null
          archetype: string | null
          completed_at: string | null
          created_at: string
          current_chunk: number
          demographic_context: Json | null
          email: string | null
          first_name: string | null
          id: string
          is_synthetic: boolean
          metadata: Json | null
          persona_type: string | null
          score_details: Json | null
          scores: Json | null
          secondary_archetype: string | null
          started_at: string
          status: string
          token: string
          total_chunks: number
          validity_flags: Json | null
          version: string
        }
        Insert: {
          ai_analysis?: Json | null
          archetype?: string | null
          completed_at?: string | null
          created_at?: string
          current_chunk?: number
          demographic_context?: Json | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_synthetic?: boolean
          metadata?: Json | null
          persona_type?: string | null
          score_details?: Json | null
          scores?: Json | null
          secondary_archetype?: string | null
          started_at?: string
          status?: string
          token: string
          total_chunks: number
          validity_flags?: Json | null
          version: string
        }
        Update: {
          ai_analysis?: Json | null
          archetype?: string | null
          completed_at?: string | null
          created_at?: string
          current_chunk?: number
          demographic_context?: Json | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_synthetic?: boolean
          metadata?: Json | null
          persona_type?: string | null
          score_details?: Json | null
          scores?: Json | null
          secondary_archetype?: string | null
          started_at?: string
          status?: string
          token?: string
          total_chunks?: number
          validity_flags?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_sessions_archetype_fkey"
            columns: ["archetype"]
            isOneToOne: false
            referencedRelation: "archetype_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_sessions_secondary_archetype_fkey"
            columns: ["secondary_archetype"]
            isOneToOne: false
            referencedRelation: "archetype_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_submissions: {
        Row: {
          answers: Json
          assessment_id: string
          attempt_number: number
          created_at: string
          feedback: Json | null
          graded_at: string | null
          id: string
          score: number | null
          status: string
          user_id: string
        }
        Insert: {
          answers: Json
          assessment_id: string
          attempt_number?: number
          created_at?: string
          feedback?: Json | null
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: string
          user_id: string
        }
        Update: {
          answers?: Json
          assessment_id?: string
          attempt_number?: number
          created_at?: string
          feedback?: Json | null
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_submissions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          instructions: string | null
          max_retakes: number
          module_id: string
          passing_score: number
          questions: Json
          slug: string
          sort_order: number
          title: string
          type: Database["public"]["Enums"]["assessment_type"]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          max_retakes?: number
          module_id: string
          passing_score?: number
          questions?: Json
          slug: string
          sort_order?: number
          title: string
          type: Database["public"]["Enums"]["assessment_type"]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          max_retakes?: number
          module_id?: string
          passing_score?: number
          questions?: Json
          slug?: string
          sort_order?: number
          title?: string
          type?: Database["public"]["Enums"]["assessment_type"]
        }
        Relationships: [
          {
            foreignKeyName: "assessments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      attachment_inspections: {
        Row: {
          attachment_id: string
          company_id: string
          connection_id: string | null
          email_attachment_id: string | null
          facts: Json
          id: string
          inspected_at: string
          is_signed_estimate: boolean
          message_id: string
          model: string | null
          provider_thread_id: string | null
          summary: string | null
        }
        Insert: {
          attachment_id: string
          company_id: string
          connection_id?: string | null
          email_attachment_id?: string | null
          facts?: Json
          id?: string
          inspected_at?: string
          is_signed_estimate?: boolean
          message_id: string
          model?: string | null
          provider_thread_id?: string | null
          summary?: string | null
        }
        Update: {
          attachment_id?: string
          company_id?: string
          connection_id?: string | null
          email_attachment_id?: string | null
          facts?: Json
          id?: string
          inspected_at?: string
          is_signed_estimate?: boolean
          message_id?: string
          model?: string | null
          provider_thread_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachment_inspections_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_inspections_email_attachment_id_fkey"
            columns: ["email_attachment_id"]
            isOneToOne: true
            referencedRelation: "email_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          company_id: string
          id: number
          new_data: Json | null
          old_data: Json | null
          record_id: string
          table_name: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          company_id: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          table_name: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          company_id?: string
          id?: number
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      beta_access_requests: {
        Row: {
          admin_notes: string | null
          company_id: string
          company_name: string
          feature_flag_slug: string | null
          id: string
          requested_at: string
          reviewed_at: string | null
          status: string
          user_email: string
          user_id: string
          user_name: string
          whats_new_item_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          company_id: string
          company_name: string
          feature_flag_slug?: string | null
          id?: string
          requested_at?: string
          reviewed_at?: string | null
          status?: string
          user_email: string
          user_id: string
          user_name: string
          whats_new_item_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          company_id?: string
          company_name?: string
          feature_flag_slug?: string | null
          id?: string
          requested_at?: string
          reviewed_at?: string | null
          status?: string
          user_email?: string
          user_id?: string
          user_name?: string
          whats_new_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "beta_access_requests_whats_new_item_id_fkey"
            columns: ["whats_new_item_id"]
            isOneToOne: false
            referencedRelation: "whats_new_items"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          amount_cents: number | null
          company_id: string | null
          currency: string | null
          event_type: string
          id: string
          occurred_at: string
          raw: Json
          received_at: string
          stripe_customer_id: string | null
          stripe_event_id: string
        }
        Insert: {
          amount_cents?: number | null
          company_id?: string | null
          currency?: string | null
          event_type: string
          id?: string
          occurred_at: string
          raw: Json
          received_at?: string
          stripe_customer_id?: string | null
          stripe_event_id: string
        }
        Update: {
          amount_cents?: number | null
          company_id?: string | null
          currency?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          raw?: Json
          received_at?: string
          stripe_customer_id?: string | null
          stripe_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      blog_posts: {
        Row: {
          author: string | null
          category_id: string | null
          category2_id: string | null
          content: string
          created_at: string
          display_views: number
          email_content: string | null
          faqs: Json | null
          id: string
          image_prompt: string | null
          is_live: boolean
          linkedin_article: string | null
          meta_title: string | null
          published_at: string | null
          slug: string
          subtitle: string | null
          summary: string | null
          teaser: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
          word_count: number
        }
        Insert: {
          author?: string | null
          category_id?: string | null
          category2_id?: string | null
          content?: string
          created_at?: string
          display_views?: number
          email_content?: string | null
          faqs?: Json | null
          id?: string
          image_prompt?: string | null
          is_live?: boolean
          linkedin_article?: string | null
          meta_title?: string | null
          published_at?: string | null
          slug: string
          subtitle?: string | null
          summary?: string | null
          teaser?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          word_count?: number
        }
        Update: {
          author?: string | null
          category_id?: string | null
          category2_id?: string | null
          content?: string
          created_at?: string
          display_views?: number
          email_content?: string | null
          faqs?: Json | null
          id?: string
          image_prompt?: string | null
          is_live?: boolean
          linkedin_article?: string | null
          meta_title?: string | null
          published_at?: string | null
          slug?: string
          subtitle?: string | null
          summary?: string | null
          teaser?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blog_posts_category2_id_fkey"
            columns: ["category2_id"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_topics: {
        Row: {
          author: string
          created_at: string
          id: string
          image_url: string | null
          topic: string
          updated_at: string
          used: boolean
        }
        Insert: {
          author?: string
          created_at?: string
          id?: string
          image_url?: string | null
          topic: string
          updated_at?: string
          used?: boolean
        }
        Update: {
          author?: string
          created_at?: string
          id?: string
          image_url?: string | null
          topic?: string
          updated_at?: string
          used?: boolean
        }
        Relationships: []
      }
      bug_reports: {
        Row: {
          additional_attachments: string[] | null
          app_version: string | null
          assigned_to: string | null
          battery_level: number | null
          breadcrumbs: Json | null
          browser: string | null
          browser_version: string | null
          build_number: string | null
          category: string | null
          claimed_at: string | null
          company_id: string
          console_logs: Json | null
          created_at: string | null
          custom_metadata: Json | null
          dedupe_key: string | null
          description: string
          device_model: string | null
          fix_branch: string | null
          fix_commit: string | null
          fix_notes: string | null
          fix_pr_url: string | null
          fixed_at: string | null
          free_disk_mb: number | null
          free_ram_mb: number | null
          human_review_reason: string | null
          id: string
          last_reported_at: string
          network_log: Json | null
          network_type: string | null
          os_name: string | null
          os_version: string | null
          platform: string
          priority: string | null
          reporter_email: string | null
          reporter_id: string
          reporter_name: string | null
          requires_human_review: boolean
          resolution_notes: string | null
          resolved_at: string | null
          screen_name: string | null
          screenshot_url: string | null
          state_snapshot: Json | null
          status: string | null
          times_reported: number
          updated_at: string | null
          url: string | null
          viewport_height: number | null
          viewport_width: number | null
        }
        Insert: {
          additional_attachments?: string[] | null
          app_version?: string | null
          assigned_to?: string | null
          battery_level?: number | null
          breadcrumbs?: Json | null
          browser?: string | null
          browser_version?: string | null
          build_number?: string | null
          category?: string | null
          claimed_at?: string | null
          company_id: string
          console_logs?: Json | null
          created_at?: string | null
          custom_metadata?: Json | null
          dedupe_key?: string | null
          description: string
          device_model?: string | null
          fix_branch?: string | null
          fix_commit?: string | null
          fix_notes?: string | null
          fix_pr_url?: string | null
          fixed_at?: string | null
          free_disk_mb?: number | null
          free_ram_mb?: number | null
          human_review_reason?: string | null
          id?: string
          last_reported_at?: string
          network_log?: Json | null
          network_type?: string | null
          os_name?: string | null
          os_version?: string | null
          platform: string
          priority?: string | null
          reporter_email?: string | null
          reporter_id: string
          reporter_name?: string | null
          requires_human_review?: boolean
          resolution_notes?: string | null
          resolved_at?: string | null
          screen_name?: string | null
          screenshot_url?: string | null
          state_snapshot?: Json | null
          status?: string | null
          times_reported?: number
          updated_at?: string | null
          url?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Update: {
          additional_attachments?: string[] | null
          app_version?: string | null
          assigned_to?: string | null
          battery_level?: number | null
          breadcrumbs?: Json | null
          browser?: string | null
          browser_version?: string | null
          build_number?: string | null
          category?: string | null
          claimed_at?: string | null
          company_id?: string
          console_logs?: Json | null
          created_at?: string | null
          custom_metadata?: Json | null
          dedupe_key?: string | null
          description?: string
          device_model?: string | null
          fix_branch?: string | null
          fix_commit?: string | null
          fix_notes?: string | null
          fix_pr_url?: string | null
          fixed_at?: string | null
          free_disk_mb?: number | null
          free_ram_mb?: number | null
          human_review_reason?: string | null
          id?: string
          last_reported_at?: string
          network_log?: Json | null
          network_type?: string | null
          os_name?: string | null
          os_version?: string | null
          platform?: string
          priority?: string | null
          reporter_email?: string | null
          reporter_id?: string
          reporter_name?: string | null
          requires_human_review?: boolean
          resolution_notes?: string | null
          resolved_at?: string | null
          screen_name?: string | null
          screenshot_url?: string | null
          state_snapshot?: Json | null
          status?: string | null
          times_reported?: number
          updated_at?: string | null
          url?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Relationships: []
      }
      bundle_courses: {
        Row: {
          bundle_id: string
          course_id: string
          sort_order: number
        }
        Insert: {
          bundle_id: string
          course_id: string
          sort_order?: number
        }
        Update: {
          bundle_id?: string
          course_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "bundle_courses_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "course_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          bubble_id: string | null
          color: string | null
          company_id: string
          created_at: string | null
          deleted_at: string | null
          duration: number | null
          end_date: string | null
          id: string
          project_id: string | null
          start_date: string | null
          team_member_ids: string[] | null
          title: string
          updated_at: string | null
        }
        Insert: {
          bubble_id?: string | null
          color?: string | null
          company_id: string
          created_at?: string | null
          deleted_at?: string | null
          duration?: number | null
          end_date?: string | null
          id?: string
          project_id?: string | null
          start_date?: string | null
          team_member_ids?: string[] | null
          title: string
          updated_at?: string | null
        }
        Update: {
          bubble_id?: string | null
          color?: string | null
          company_id?: string
          created_at?: string | null
          deleted_at?: string | null
          duration?: number | null
          end_date?: string | null
          id?: string
          project_id?: string | null
          start_date?: string | null
          team_member_ids?: string[] | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_user_events: {
        Row: {
          address: string | null
          all_day: boolean
          company_id: string
          created_at: string
          deleted_at: string | null
          end_date: string
          id: string
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          series_id: string | null
          start_date: string
          status: string
          team_member_ids: string[] | null
          title: string
          type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          all_day?: boolean
          company_id: string
          created_at?: string
          deleted_at?: string | null
          end_date: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          series_id?: string | null
          start_date: string
          status?: string
          team_member_ids?: string[] | null
          title?: string
          type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          all_day?: boolean
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          end_date?: string
          id?: string
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          series_id?: string | null
          start_date?: string
          status?: string
          team_member_ids?: string[] | null
          title?: string
          type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      catalog_categories: {
        Row: {
          color_hex: string | null
          company_id: string
          created_at: string
          default_critical_threshold: number | null
          default_warning_threshold: number | null
          deleted_at: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          color_hex?: string | null
          company_id: string
          created_at?: string
          default_critical_threshold?: number | null
          default_warning_threshold?: number | null
          deleted_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color_hex?: string | null
          company_id?: string
          created_at?: string
          default_critical_threshold?: number | null
          default_warning_threshold?: number | null
          deleted_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_item_tags: {
        Row: {
          catalog_item_id: string
          id: string
          tag_id: string
        }
        Insert: {
          catalog_item_id: string
          id?: string
          tag_id: string
        }
        Update: {
          catalog_item_id?: string
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_tags_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "catalog_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "inventory_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_items: {
        Row: {
          category_id: string | null
          company_id: string
          created_at: string
          default_critical_threshold: number | null
          default_price: number | null
          default_unit_cost: number | null
          default_unit_id: string | null
          default_warning_threshold: number | null
          deleted_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          category_id?: string | null
          company_id: string
          created_at?: string
          default_critical_threshold?: number | null
          default_price?: number | null
          default_unit_cost?: number | null
          default_unit_id?: string | null
          default_warning_threshold?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          category_id?: string | null
          company_id?: string
          created_at?: string
          default_critical_threshold?: number | null
          default_price?: number | null
          default_unit_cost?: number | null
          default_unit_id?: string | null
          default_warning_threshold?: number | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_default_unit_id_fkey"
            columns: ["default_unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_items_default_unit_id_fkey"
            columns: ["default_unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_option_values: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          option_id: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          option_id: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          option_id?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_option_values_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "catalog_options"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_options: {
        Row: {
          catalog_item_id: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_options_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_order_items: {
        Row: {
          catalog_variant_id: string
          cost_per_unit: number | null
          id: string
          notes: string | null
          order_id: string
          quantity_requested: number
        }
        Insert: {
          catalog_variant_id: string
          cost_per_unit?: number | null
          id?: string
          notes?: string | null
          order_id: string
          quantity_requested: number
        }
        Update: {
          catalog_variant_id?: string
          cost_per_unit?: number | null
          id?: string
          notes?: string | null
          order_id?: string
          quantity_requested?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_order_items_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_order_items_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "catalog_order_items_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "catalog_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_orders: {
        Row: {
          cancelled_at: string | null
          company_id: string
          created_at: string
          created_by_id: string | null
          deleted_at: string | null
          expected_delivery_date: string | null
          fulfilled_at: string | null
          id: string
          notes: string | null
          sent_at: string | null
          status: string
          supplier_contact: string | null
          supplier_name: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          company_id: string
          created_at?: string
          created_by_id?: string | null
          deleted_at?: string | null
          expected_delivery_date?: string | null
          fulfilled_at?: string | null
          id?: string
          notes?: string | null
          sent_at?: string | null
          status?: string
          supplier_contact?: string | null
          supplier_name?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          company_id?: string
          created_at?: string
          created_by_id?: string | null
          deleted_at?: string | null
          expected_delivery_date?: string | null
          fulfilled_at?: string | null
          id?: string
          notes?: string | null
          sent_at?: string | null
          status?: string
          supplier_contact?: string | null
          supplier_name?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_orders_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_product_option_mappings: {
        Row: {
          catalog_item_id: string
          catalog_option_id: string
          catalog_option_value_id: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          mapping_kind: string
          product_id: string
          product_option_id: string
          product_option_value_id: string | null
          updated_at: string
        }
        Insert: {
          catalog_item_id: string
          catalog_option_id: string
          catalog_option_value_id?: string | null
          company_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          mapping_kind?: string
          product_id: string
          product_option_id: string
          product_option_value_id?: string | null
          updated_at?: string
        }
        Update: {
          catalog_item_id?: string
          catalog_option_id?: string
          catalog_option_value_id?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          mapping_kind?: string
          product_id?: string
          product_option_id?: string
          product_option_value_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_product_option_mappings_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_option_mappings_catalog_option_id_fkey"
            columns: ["catalog_option_id"]
            isOneToOne: false
            referencedRelation: "catalog_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_option_mappings_catalog_option_value_id_fkey"
            columns: ["catalog_option_value_id"]
            isOneToOne: false
            referencedRelation: "catalog_option_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_option_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_option_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_option_mappings_product_option_id_fkey"
            columns: ["product_option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_product_option_mappings_product_option_value_id_fkey"
            columns: ["product_option_value_id"]
            isOneToOne: false
            referencedRelation: "product_option_values"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_setup_save_requests: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          error: Json | null
          id: string
          idempotency_key: string
          request_hash: string
          response: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          error?: Json | null
          id?: string
          idempotency_key: string
          request_hash: string
          response?: Json | null
          status: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          error?: Json | null
          id?: string
          idempotency_key?: string
          request_hash?: string
          response?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_setup_save_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_snapshot_items: {
        Row: {
          description: string | null
          family_name: string
          id: string
          original_variant_id: string | null
          quantity: number
          sku: string | null
          snapshot_id: string
          unit_display: string | null
          variant_label: string | null
        }
        Insert: {
          description?: string | null
          family_name: string
          id?: string
          original_variant_id?: string | null
          quantity?: number
          sku?: string | null
          snapshot_id: string
          unit_display?: string | null
          variant_label?: string | null
        }
        Update: {
          description?: string | null
          family_name?: string
          id?: string
          original_variant_id?: string | null
          quantity?: number
          sku?: string | null
          snapshot_id?: string
          unit_display?: string | null
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_snapshot_items_original_variant_id_fkey"
            columns: ["original_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_original_variant_id_fkey"
            columns: ["original_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_original_variant_id_fkey"
            columns: ["original_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "catalog_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "inventory_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_snapshots: {
        Row: {
          company_id: string
          created_at: string
          created_by_id: string | null
          id: string
          is_automatic: boolean
          item_count: number
          notes: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          is_automatic?: boolean
          item_count?: number
          notes?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by_id?: string | null
          id?: string
          is_automatic?: boolean
          item_count?: number
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshots_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_stock_unit_events: {
        Row: {
          catalog_stock_unit_id: string
          catalog_variant_id: string
          company_id: string
          created_at: string
          created_by: string | null
          event_type: string
          from_status: string | null
          id: string
          marker: string | null
          notes: string | null
          payload: Json
          quantity_delta: number | null
          related_catalog_stock_unit_id: string | null
          remaining_length_delta: number | null
          to_status: string | null
        }
        Insert: {
          catalog_stock_unit_id: string
          catalog_variant_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          event_type: string
          from_status?: string | null
          id?: string
          marker?: string | null
          notes?: string | null
          payload?: Json
          quantity_delta?: number | null
          related_catalog_stock_unit_id?: string | null
          remaining_length_delta?: number | null
          to_status?: string | null
        }
        Update: {
          catalog_stock_unit_id?: string
          catalog_variant_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          from_status?: string | null
          id?: string
          marker?: string | null
          notes?: string | null
          payload?: Json
          quantity_delta?: number | null
          related_catalog_stock_unit_id?: string | null
          remaining_length_delta?: number | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_stock_unit_events_catalog_stock_unit_id_fkey"
            columns: ["catalog_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_stock_unit_events_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_stock_unit_events_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "catalog_stock_unit_events_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_stock_unit_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_stock_unit_events_related_catalog_stock_unit_id_fkey"
            columns: ["related_catalog_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_stock_units"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_stock_units: {
        Row: {
          catalog_variant_id: string
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          label: string | null
          length_unit: string | null
          location: string | null
          lot_code: string | null
          notes: string | null
          original_length_value: number | null
          quantity_value: number
          remaining_length_value: number | null
          source_order_item_id: string | null
          status: string
          unit_kind: string
          updated_at: string
          width_unit: string | null
          width_value: number | null
        }
        Insert: {
          catalog_variant_id: string
          company_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label?: string | null
          length_unit?: string | null
          location?: string | null
          lot_code?: string | null
          notes?: string | null
          original_length_value?: number | null
          quantity_value?: number
          remaining_length_value?: number | null
          source_order_item_id?: string | null
          status?: string
          unit_kind?: string
          updated_at?: string
          width_unit?: string | null
          width_value?: number | null
        }
        Update: {
          catalog_variant_id?: string
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label?: string | null
          length_unit?: string | null
          location?: string | null
          lot_code?: string | null
          notes?: string | null
          original_length_value?: number | null
          quantity_value?: number
          remaining_length_value?: number | null
          source_order_item_id?: string | null
          status?: string
          unit_kind?: string
          updated_at?: string
          width_unit?: string | null
          width_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_stock_units_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_stock_units_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "catalog_stock_units_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_stock_units_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_stock_units_source_order_item_id_fkey"
            columns: ["source_order_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_tags: {
        Row: {
          company_id: string
          created_at: string
          critical_threshold: number | null
          deleted_at: string | null
          id: string
          name: string
          updated_at: string
          warning_threshold: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          critical_threshold?: number | null
          deleted_at?: string | null
          id?: string
          name: string
          updated_at?: string
          warning_threshold?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          critical_threshold?: number | null
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string
          warning_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_tags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_units: {
        Row: {
          abbreviation: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          dimension: string
          display: string
          id: string
          is_default: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          abbreviation?: string | null
          company_id: string
          created_at?: string
          deleted_at?: string | null
          dimension?: string
          display: string
          id?: string
          is_default?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          abbreviation?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          dimension?: string
          display?: string
          id?: string
          is_default?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_units_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_variant_option_values: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          option_value_id: string
          updated_at: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          option_value_id: string
          updated_at?: string
          variant_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          option_value_id?: string
          updated_at?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_variant_option_values_option_value_id_fkey"
            columns: ["option_value_id"]
            isOneToOne: false
            referencedRelation: "catalog_option_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variant_option_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variant_option_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "catalog_variant_option_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_variants: {
        Row: {
          catalog_item_id: string
          company_id: string
          created_at: string
          critical_threshold: number | null
          deleted_at: string | null
          id: string
          is_active: boolean
          price_override: number | null
          quantity: number
          sku: string | null
          unit_cost_override: number | null
          unit_id: string | null
          updated_at: string
          warning_threshold: number | null
        }
        Insert: {
          catalog_item_id: string
          company_id: string
          created_at?: string
          critical_threshold?: number | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          price_override?: number | null
          quantity?: number
          sku?: string | null
          unit_cost_override?: number | null
          unit_id?: string | null
          updated_at?: string
          warning_threshold?: number | null
        }
        Update: {
          catalog_item_id?: string
          company_id?: string
          created_at?: string
          critical_threshold?: number | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          price_override?: number | null
          quantity?: number
          sku?: string | null
          unit_cost_override?: number | null
          unit_id?: string | null
          updated_at?: string
          warning_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_variants_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variants_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variants_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_url: string | null
          course_id: string
          id: string
          issued_at: string
          user_id: string
        }
        Insert: {
          certificate_url?: string | null
          course_id: string
          id?: string
          issued_at?: string
          user_id: string
        }
        Update: {
          certificate_url?: string | null
          course_id?: string
          id?: string
          issued_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_attempts: {
        Row: {
          answers: Json
          challenge_id: string
          converted: boolean
          converted_at: string | null
          created_at: string
          discount_code: string | null
          discount_percentage: number | null
          feedback: Json | null
          graded_at: string | null
          id: string
          score: number | null
          status: string
          user_id: string
        }
        Insert: {
          answers: Json
          challenge_id: string
          converted?: boolean
          converted_at?: string | null
          created_at?: string
          discount_code?: string | null
          discount_percentage?: number | null
          feedback?: Json | null
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: string
          user_id: string
        }
        Update: {
          answers?: Json
          challenge_id?: string
          converted?: boolean
          converted_at?: string | null
          created_at?: string
          discount_code?: string | null
          discount_percentage?: number | null
          feedback?: Json | null
          graded_at?: string | null
          id?: string
          score?: number | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_attempts_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "course_challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      client_product_overrides: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          id: string
          notes: string | null
          product_id: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_product_overrides_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_product_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_product_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          bubble_id: string | null
          company_id: string
          created_at: string | null
          deleted_at: string | null
          email: string | null
          id: string
          latitude: number | null
          longitude: number | null
          merged_into_client_id: string | null
          name: string
          notes: string | null
          phone_number: string | null
          pricing_tier: string
          profile_image_url: string | null
          qb_id: string | null
          sage_id: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          bubble_id?: string | null
          company_id: string
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          merged_into_client_id?: string | null
          name: string
          notes?: string | null
          phone_number?: string | null
          pricing_tier?: string
          profile_image_url?: string | null
          qb_id?: string | null
          sage_id?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          bubble_id?: string | null
          company_id?: string
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          merged_into_client_id?: string | null
          name?: string
          notes?: string | null
          phone_number?: string | null
          pricing_tier?: string
          profile_image_url?: string | null
          qb_id?: string | null
          sage_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_merged_into_client_id_fkey"
            columns: ["merged_into_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          account_holder_id: string | null
          address: string | null
          admin_ids: string[] | null
          ai_enabled: boolean
          bubble_id: string | null
          client_comms_settings: Json | null
          close_hour: string | null
          company_age: string | null
          company_code: string | null
          company_size: string | null
          created_at: string | null
          currency_code: string
          data_setup_completed: boolean | null
          data_setup_purchased: boolean | null
          data_setup_scheduled: string | null
          default_project_color: string | null
          default_work_end: string
          default_work_start: string
          deleted_at: string | null
          description: string | null
          email: string | null
          external_id: string | null
          has_priority_support: boolean | null
          id: string
          industries: string[] | null
          industry: string | null
          latitude: number | null
          lifecycle_settings: Json | null
          locale: string
          logo_url: string | null
          longitude: number | null
          max_seats: number | null
          name: string
          open_hour: string | null
          phone: string | null
          physical_address: string | null
          precise_scheduling_enabled: boolean | null
          priority_support_period: string | null
          referral_method: string | null
          seat_grace_start_date: string | null
          seated_employee_ids: string[] | null
          skip_weekends_in_auto_schedule: boolean | null
          source_app: string
          stripe_customer_id: string | null
          subscription_end: string | null
          subscription_ids_json: string | null
          subscription_period: string | null
          subscription_plan: string | null
          subscription_status: string | null
          timezone: string
          trial_end_date: string | null
          trial_start_date: string | null
          updated_at: string | null
          weather_dependent: boolean | null
          website: string | null
        }
        Insert: {
          account_holder_id?: string | null
          address?: string | null
          admin_ids?: string[] | null
          ai_enabled?: boolean
          bubble_id?: string | null
          client_comms_settings?: Json | null
          close_hour?: string | null
          company_age?: string | null
          company_code?: string | null
          company_size?: string | null
          created_at?: string | null
          currency_code?: string
          data_setup_completed?: boolean | null
          data_setup_purchased?: boolean | null
          data_setup_scheduled?: string | null
          default_project_color?: string | null
          default_work_end?: string
          default_work_start?: string
          deleted_at?: string | null
          description?: string | null
          email?: string | null
          external_id?: string | null
          has_priority_support?: boolean | null
          id?: string
          industries?: string[] | null
          industry?: string | null
          latitude?: number | null
          lifecycle_settings?: Json | null
          locale?: string
          logo_url?: string | null
          longitude?: number | null
          max_seats?: number | null
          name: string
          open_hour?: string | null
          phone?: string | null
          physical_address?: string | null
          precise_scheduling_enabled?: boolean | null
          priority_support_period?: string | null
          referral_method?: string | null
          seat_grace_start_date?: string | null
          seated_employee_ids?: string[] | null
          skip_weekends_in_auto_schedule?: boolean | null
          source_app?: string
          stripe_customer_id?: string | null
          subscription_end?: string | null
          subscription_ids_json?: string | null
          subscription_period?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          timezone?: string
          trial_end_date?: string | null
          trial_start_date?: string | null
          updated_at?: string | null
          weather_dependent?: boolean | null
          website?: string | null
        }
        Update: {
          account_holder_id?: string | null
          address?: string | null
          admin_ids?: string[] | null
          ai_enabled?: boolean
          bubble_id?: string | null
          client_comms_settings?: Json | null
          close_hour?: string | null
          company_age?: string | null
          company_code?: string | null
          company_size?: string | null
          created_at?: string | null
          currency_code?: string
          data_setup_completed?: boolean | null
          data_setup_purchased?: boolean | null
          data_setup_scheduled?: string | null
          default_project_color?: string | null
          default_work_end?: string
          default_work_start?: string
          deleted_at?: string | null
          description?: string | null
          email?: string | null
          external_id?: string | null
          has_priority_support?: boolean | null
          id?: string
          industries?: string[] | null
          industry?: string | null
          latitude?: number | null
          lifecycle_settings?: Json | null
          locale?: string
          logo_url?: string | null
          longitude?: number | null
          max_seats?: number | null
          name?: string
          open_hour?: string | null
          phone?: string | null
          physical_address?: string | null
          precise_scheduling_enabled?: boolean | null
          priority_support_period?: string | null
          referral_method?: string | null
          seat_grace_start_date?: string | null
          seated_employee_ids?: string[] | null
          skip_weekends_in_auto_schedule?: boolean | null
          source_app?: string
          stripe_customer_id?: string | null
          subscription_end?: string | null
          subscription_ids_json?: string | null
          subscription_period?: string | null
          subscription_plan?: string | null
          subscription_status?: string | null
          timezone?: string
          trial_end_date?: string | null
          trial_start_date?: string | null
          updated_at?: string | null
          weather_dependent?: boolean | null
          website?: string | null
        }
        Relationships: []
      }
      company_default_products: {
        Row: {
          company_id: string
          component_type: string
          created_at: string
          product_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          component_type: string
          created_at?: string
          product_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          component_type?: string
          created_at?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_default_products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_default_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      company_inventory_settings: {
        Row: {
          company_id: string
          created_at: string
          disabled_at: string | null
          enabled_at: string | null
          inventory_mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          disabled_at?: string | null
          enabled_at?: string | null
          inventory_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          disabled_at?: string | null
          enabled_at?: string | null
          inventory_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_inventory_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_inventory_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          auto_generate_tasks: boolean
          company_id: string
          created_at: string | null
          follow_up_reminder_days: number
          gmail_auto_log_enabled: boolean
          updated_at: string | null
        }
        Insert: {
          auto_generate_tasks?: boolean
          company_id: string
          created_at?: string | null
          follow_up_reminder_days?: number
          gmail_auto_log_enabled?: boolean
          updated_at?: string | null
        }
        Update: {
          auto_generate_tasks?: boolean
          company_id?: string
          created_at?: string | null
          follow_up_reminder_days?: number
          gmail_auto_log_enabled?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      contact_messages: {
        Row: {
          created_at: string | null
          email: string
          id: string
          message: string
          name: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          message: string
          name?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          message?: string
          name?: string | null
        }
        Relationships: []
      }
      content_blocks: {
        Row: {
          content: Json
          created_at: string
          id: string
          lesson_id: string
          sort_order: number
          type: Database["public"]["Enums"]["content_block_type"]
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          lesson_id: string
          sort_order?: number
          type: Database["public"]["Enums"]["content_block_type"]
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          lesson_id?: string
          sort_order?: number
          type?: Database["public"]["Enums"]["content_block_type"]
        }
        Relationships: [
          {
            foreignKeyName: "content_blocks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      conversion_event_outbox: {
        Row: {
          attempts: number
          created_at: string
          event_name: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          payload: Json
          sent_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_name: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          payload: Json
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_name?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          payload?: Json
          sent_at?: string | null
          status?: string
        }
        Relationships: []
      }
      course_bundles: {
        Row: {
          created_at: string
          description: string | null
          discount_pct: number | null
          id: string
          pick_count: number | null
          price_cents: number | null
          slug: string
          sort_order: number | null
          status: string
          stripe_coupon_id: string | null
          stripe_price_id: string | null
          thumbnail_url: string | null
          title: string
          type: Database["public"]["Enums"]["bundle_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          id?: string
          pick_count?: number | null
          price_cents?: number | null
          slug: string
          sort_order?: number | null
          status?: string
          stripe_coupon_id?: string | null
          stripe_price_id?: string | null
          thumbnail_url?: string | null
          title: string
          type: Database["public"]["Enums"]["bundle_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          id?: string
          pick_count?: number | null
          price_cents?: number | null
          slug?: string
          sort_order?: number | null
          status?: string
          stripe_coupon_id?: string | null
          stripe_price_id?: string | null
          thumbnail_url?: string | null
          title?: string
          type?: Database["public"]["Enums"]["bundle_type"]
          updated_at?: string
        }
        Relationships: []
      }
      course_challenges: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          discount_tiers: Json
          id: string
          passing_score: number
          questions: Json
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          discount_tiers?: Json
          id?: string
          passing_score?: number
          questions?: Json
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          discount_tiers?: Json
          id?: string
          passing_score?: number
          questions?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_challenges_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: true
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_grades: {
        Row: {
          assessment_count: number
          course_id: string
          graded_count: number
          id: string
          overall_score: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assessment_count?: number
          course_id: string
          graded_count?: number
          id?: string
          overall_score?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assessment_count?: number
          course_id?: string
          graded_count?: number
          id?: string
          overall_score?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_grades_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          description: string | null
          display_enrollments: number | null
          display_rating: number | null
          display_review_count: number | null
          estimated_duration_minutes: number | null
          id: string
          price_cents: number
          slug: string
          sort_order: number
          status: Database["public"]["Enums"]["course_status"]
          stripe_price_id: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_enrollments?: number | null
          display_rating?: number | null
          display_review_count?: number | null
          estimated_duration_minutes?: number | null
          id?: string
          price_cents?: number
          slug: string
          sort_order?: number
          status?: Database["public"]["Enums"]["course_status"]
          stripe_price_id?: string | null
          thumbnail_url?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          display_enrollments?: number | null
          display_rating?: number | null
          display_review_count?: number | null
          estimated_duration_minutes?: number | null
          id?: string
          price_cents?: number
          slug?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["course_status"]
          stripe_price_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      crew_locations: {
        Row: {
          accuracy: number | null
          battery_level: number | null
          current_project_address: string | null
          current_project_id: string | null
          current_project_name: string | null
          current_task_name: string | null
          first_name: string
          heading: number | null
          is_background: boolean | null
          last_name: string | null
          lat: number
          lng: number
          org_id: string
          phone_number: string | null
          speed: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accuracy?: number | null
          battery_level?: number | null
          current_project_address?: string | null
          current_project_id?: string | null
          current_project_name?: string | null
          current_task_name?: string | null
          first_name?: string
          heading?: number | null
          is_background?: boolean | null
          last_name?: string | null
          lat: number
          lng: number
          org_id: string
          phone_number?: string | null
          speed?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accuracy?: number | null
          battery_level?: number | null
          current_project_address?: string | null
          current_project_id?: string | null
          current_project_name?: string | null
          current_task_name?: string | null
          first_name?: string
          heading?: number | null
          is_background?: boolean | null
          last_name?: string | null
          lat?: number
          lng?: number
          org_id?: string
          phone_number?: string | null
          speed?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      data_setup_requests: {
        Row: {
          amount_paid_cents: number | null
          company_id: string
          completed_at: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          notes: string | null
          requested_by: string
          scheduled_at: string | null
          source_software: string | null
          status: string
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_paid_cents?: number | null
          company_id: string
          completed_at?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          requested_by: string
          scheduled_at?: string | null
          source_software?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_paid_cents?: number | null
          company_id?: string
          completed_at?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          requested_by?: string
          scheduled_at?: string | null
          source_software?: string | null
          status?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_setup_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_setup_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_designs: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          drawing_data: Json
          id: string
          opportunity_id: string | null
          project_id: string | null
          thumbnail_url: string | null
          title: string
          updated_at: string | null
          version: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          drawing_data?: Json
          id?: string
          opportunity_id?: string | null
          project_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          version?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          drawing_data?: Json
          id?: string
          opportunity_id?: string | null
          project_id?: string | null
          thumbnail_url?: string | null
          title?: string
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "deck_designs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deck_designs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deck_designs_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deck_designs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deck_designs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_subscriptions: {
        Row: {
          company_id: string
          created_at: string
          current_period_end: string | null
          customer_id: string | null
          deleted_at: string | null
          entitlement: string
          expires_at: string | null
          last_event_at: string
          product_id: string
          provider: string
          status: string
          store: string
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          current_period_end?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          entitlement?: string
          expires_at?: string | null
          last_event_at?: string
          product_id: string
          provider?: string
          status: string
          store?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          current_period_end?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          entitlement?: string
          expires_at?: string | null
          last_event_at?: string
          product_id?: string
          provider?: string
          status?: string
          store?: string
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deck_subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          company_id: string
          document_type: string
          fiscal_year: number
          last_number: number
          prefix: string
        }
        Insert: {
          company_id: string
          document_type: string
          fiscal_year?: number
          last_number?: number
          prefix: string
        }
        Update: {
          company_id?: string
          document_type?: string
          fiscal_year?: number
          last_number?: number
          prefix?: string
        }
        Relationships: []
      }
      document_templates: {
        Row: {
          company_id: string
          created_at: string
          document_type: string
          id: string
          is_default: boolean
          name: string
          override_accent_color: string | null
          override_font_combo: string | null
          override_logo_url: string | null
          override_template: string | null
          override_theme_mode: string | null
          show_descriptions: boolean
          show_discount: boolean
          show_footer: boolean
          show_from_section: boolean
          show_line_totals: boolean
          show_payment_info: boolean
          show_quantities: boolean
          show_tax: boolean
          show_terms: boolean
          show_to_section: boolean
          show_unit_prices: boolean
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          document_type: string
          id?: string
          is_default?: boolean
          name: string
          override_accent_color?: string | null
          override_font_combo?: string | null
          override_logo_url?: string | null
          override_template?: string | null
          override_theme_mode?: string | null
          show_descriptions?: boolean
          show_discount?: boolean
          show_footer?: boolean
          show_from_section?: boolean
          show_line_totals?: boolean
          show_payment_info?: boolean
          show_quantities?: boolean
          show_tax?: boolean
          show_terms?: boolean
          show_to_section?: boolean
          show_unit_prices?: boolean
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          document_type?: string
          id?: string
          is_default?: boolean
          name?: string
          override_accent_color?: string | null
          override_font_combo?: string | null
          override_logo_url?: string | null
          override_template?: string | null
          override_theme_mode?: string | null
          show_descriptions?: boolean
          show_discount?: boolean
          show_footer?: boolean
          show_from_section?: boolean
          show_line_totals?: boolean
          show_payment_info?: boolean
          show_quantities?: boolean
          show_tax?: boolean
          show_terms?: boolean
          show_to_section?: boolean
          show_unit_prices?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      duplicate_reviews: {
        Row: {
          company_id: string
          confidence: string
          created_at: string
          entity_a_id: string
          entity_b_id: string
          entity_type: string
          id: string
          migration_manifest: Json
          resolved_at: string | null
          resolved_by: string | null
          signals: Json
          status: string
          winner_id: string | null
        }
        Insert: {
          company_id: string
          confidence: string
          created_at?: string
          entity_a_id: string
          entity_b_id: string
          entity_type: string
          id?: string
          migration_manifest?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          signals?: Json
          status?: string
          winner_id?: string | null
        }
        Update: {
          company_id?: string
          confidence?: string
          created_at?: string
          entity_a_id?: string
          entity_b_id?: string
          entity_type?: string
          id?: string
          migration_manifest?: Json
          resolved_at?: string | null
          resolved_by?: string | null
          signals?: Json
          status?: string
          winner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "duplicate_reviews_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "duplicate_reviews_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_anomaly_log: {
        Row: {
          action_taken: string | null
          context: Json
          detected_at: string
          id: string
          kind: Database["public"]["Enums"]["email_anomaly_kind"]
          metric_value: number
          notification_id: string | null
          pause_audit_id: string | null
          resolved_at: string | null
          severity: Database["public"]["Enums"]["email_anomaly_severity"]
          threshold: number
          window_minutes: number
        }
        Insert: {
          action_taken?: string | null
          context?: Json
          detected_at?: string
          id?: string
          kind: Database["public"]["Enums"]["email_anomaly_kind"]
          metric_value: number
          notification_id?: string | null
          pause_audit_id?: string | null
          resolved_at?: string | null
          severity: Database["public"]["Enums"]["email_anomaly_severity"]
          threshold: number
          window_minutes: number
        }
        Update: {
          action_taken?: string | null
          context?: Json
          detected_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["email_anomaly_kind"]
          metric_value?: number
          notification_id?: string | null
          pause_audit_id?: string | null
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["email_anomaly_severity"]
          threshold?: number
          window_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_anomaly_log_pause_audit_id_fkey"
            columns: ["pause_audit_id"]
            isOneToOne: false
            referencedRelation: "email_pause_audit_log"
            referencedColumns: ["id"]
          },
        ]
      }
      email_audience_templates: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          description: string | null
          filter: Json
          id: string
          last_resolved_at: string | null
          last_used_count: number
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          filter: Json
          id?: string
          last_resolved_at?: string | null
          last_used_count?: number
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          description?: string | null
          filter?: Json
          id?: string
          last_resolved_at?: string | null
          last_used_count?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_campaigns: {
        Row: {
          audience_filter: Json
          audience_template_id: string | null
          bounced_count: number
          clicked_count: number
          completed_at: string | null
          created_at: string
          created_by_user_id: string | null
          delivered_count: number
          failed_count: number
          id: string
          name: string
          opened_count: number
          pause_reason: string | null
          paused_at: string | null
          recipient_count_actual: number | null
          recipient_count_estimate: number
          scheduled_for: string | null
          send_status: Database["public"]["Enums"]["email_campaign_status"]
          sent_count: number
          slug: string
          suppressed_skipped_count: number
          template_id: string
          template_version: string | null
          updated_at: string
        }
        Insert: {
          audience_filter?: Json
          audience_template_id?: string | null
          bounced_count?: number
          clicked_count?: number
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          delivered_count?: number
          failed_count?: number
          id?: string
          name: string
          opened_count?: number
          pause_reason?: string | null
          paused_at?: string | null
          recipient_count_actual?: number | null
          recipient_count_estimate?: number
          scheduled_for?: string | null
          send_status?: Database["public"]["Enums"]["email_campaign_status"]
          sent_count?: number
          slug: string
          suppressed_skipped_count?: number
          template_id: string
          template_version?: string | null
          updated_at?: string
        }
        Update: {
          audience_filter?: Json
          audience_template_id?: string | null
          bounced_count?: number
          clicked_count?: number
          completed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          delivered_count?: number
          failed_count?: number
          id?: string
          name?: string
          opened_count?: number
          pause_reason?: string | null
          paused_at?: string | null
          recipient_count_actual?: number | null
          recipient_count_estimate?: number
          scheduled_for?: string | null
          send_status?: Database["public"]["Enums"]["email_campaign_status"]
          sent_count?: number
          slug?: string
          suppressed_skipped_count?: number
          template_id?: string
          template_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_email_campaigns_audience_template"
            columns: ["audience_template_id"]
            isOneToOne: false
            referencedRelation: "email_audience_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_attachment_inspection_jobs: {
        Row: {
          attempts: number
          available_at: string
          company_id: string
          connection_id: string
          created_at: string
          email_attachment_id: string
          generation: number
          id: string
          inspected_at: string | null
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          skip_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          company_id: string
          connection_id: string
          created_at?: string
          email_attachment_id: string
          generation?: number
          id?: string
          inspected_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          available_at?: string
          company_id?: string
          connection_id?: string
          created_at?: string
          email_attachment_id?: string
          generation?: number
          id?: string
          inspected_at?: string | null
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          skip_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_attachment_inspection_jobs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachment_inspection_jobs_email_attachment_id_fkey"
            columns: ["email_attachment_id"]
            isOneToOne: true
            referencedRelation: "email_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      email_attachment_scans: {
        Row: {
          activity_id: string
          attempts: number
          available_at: string
          company_id: string
          connection_id: string
          created_at: string
          exception_notified_at: string | null
          generation: number
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_owner: string | null
          message_id: string
          provider_thread_id: string
          scanned_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          activity_id: string
          attempts?: number
          available_at?: string
          company_id: string
          connection_id: string
          created_at?: string
          exception_notified_at?: string | null
          generation?: number
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          message_id: string
          provider_thread_id: string
          scanned_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          activity_id?: string
          attempts?: number
          available_at?: string
          company_id?: string
          connection_id?: string
          created_at?: string
          exception_notified_at?: string | null
          generation?: number
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_owner?: string | null
          message_id?: string
          provider_thread_id?: string
          scanned_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_attachment_scans_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: true
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachment_scans_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      email_attachments: {
        Row: {
          activity_id: string | null
          attachment_id: string
          attribution_status: string
          company_id: string
          connection_id: string
          content_id: string | null
          content_sha256: string | null
          created_at: string
          detected_mime_type: string | null
          filename: string | null
          from_email: string | null
          id: string
          ingest_attempts: number
          ingest_status: string
          is_inline: boolean
          last_error: string | null
          last_seen_at: string
          message_id: string
          mime_type: string | null
          next_retry_at: string | null
          occurred_at: string | null
          opportunity_id: string | null
          provider_kind: string
          provider_part_id: string | null
          provider_thread_id: string
          size_bytes: number | null
          source_url: string | null
          storage_backend: string | null
          storage_path: string | null
          stored_at: string | null
          updated_at: string
          verified_size_bytes: number | null
        }
        Insert: {
          activity_id?: string | null
          attachment_id: string
          attribution_status?: string
          company_id: string
          connection_id: string
          content_id?: string | null
          content_sha256?: string | null
          created_at?: string
          detected_mime_type?: string | null
          filename?: string | null
          from_email?: string | null
          id?: string
          ingest_attempts?: number
          ingest_status?: string
          is_inline?: boolean
          last_error?: string | null
          last_seen_at?: string
          message_id: string
          mime_type?: string | null
          next_retry_at?: string | null
          occurred_at?: string | null
          opportunity_id?: string | null
          provider_kind?: string
          provider_part_id?: string | null
          provider_thread_id: string
          size_bytes?: number | null
          source_url?: string | null
          storage_backend?: string | null
          storage_path?: string | null
          stored_at?: string | null
          updated_at?: string
          verified_size_bytes?: number | null
        }
        Update: {
          activity_id?: string | null
          attachment_id?: string
          attribution_status?: string
          company_id?: string
          connection_id?: string
          content_id?: string | null
          content_sha256?: string | null
          created_at?: string
          detected_mime_type?: string | null
          filename?: string | null
          from_email?: string | null
          id?: string
          ingest_attempts?: number
          ingest_status?: string
          is_inline?: boolean
          last_error?: string | null
          last_seen_at?: string
          message_id?: string
          mime_type?: string | null
          next_retry_at?: string | null
          occurred_at?: string | null
          opportunity_id?: string | null
          provider_kind?: string
          provider_part_id?: string | null
          provider_thread_id?: string
          size_bytes?: number | null
          source_url?: string | null
          storage_backend?: string | null
          storage_path?: string | null
          stored_at?: string | null
          updated_at?: string
          verified_size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_attachments_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_attachments_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      email_connections: {
        Row: {
          access_token: string
          agent_can_send_from: boolean
          ai_memory_enabled: boolean
          ai_review_enabled: boolean
          archive_lead_preference: string
          archive_writeback_preference: string
          auto_send_settings: Json | null
          company_id: string
          created_at: string | null
          default_intake_owner_id: string | null
          email: string
          expires_at: string
          history_id: string | null
          history_recovery_anchor: string | null
          history_recovery_page_token: string | null
          history_recovery_target_token: string | null
          id: string
          last_synced_at: string | null
          ops_label_id: string | null
          provider: string
          refresh_token: string
          status: string
          sync_enabled: boolean
          sync_filters: Json
          sync_in_progress_at: string | null
          sync_interval_minutes: number
          sync_lock_owner: string | null
          type: Database["public"]["Enums"]["gmail_connection_type"]
          updated_at: string | null
          user_id: string | null
          webhook_expires_at: string | null
          webhook_client_state_hash: string | null
          webhook_subscription_id: string | null
        }
        Insert: {
          access_token: string
          agent_can_send_from?: boolean
          ai_memory_enabled?: boolean
          ai_review_enabled?: boolean
          archive_lead_preference?: string
          archive_writeback_preference?: string
          auto_send_settings?: Json | null
          company_id: string
          created_at?: string | null
          default_intake_owner_id?: string | null
          email: string
          expires_at: string
          history_id?: string | null
          history_recovery_anchor?: string | null
          history_recovery_page_token?: string | null
          history_recovery_target_token?: string | null
          id?: string
          last_synced_at?: string | null
          ops_label_id?: string | null
          provider?: string
          refresh_token: string
          status?: string
          sync_enabled?: boolean
          sync_filters?: Json
          sync_in_progress_at?: string | null
          sync_interval_minutes?: number
          sync_lock_owner?: string | null
          type?: Database["public"]["Enums"]["gmail_connection_type"]
          updated_at?: string | null
          user_id?: string | null
          webhook_expires_at?: string | null
          webhook_client_state_hash?: string | null
          webhook_subscription_id?: string | null
        }
        Update: {
          access_token?: string
          agent_can_send_from?: boolean
          ai_memory_enabled?: boolean
          ai_review_enabled?: boolean
          archive_lead_preference?: string
          archive_writeback_preference?: string
          auto_send_settings?: Json | null
          company_id?: string
          created_at?: string | null
          default_intake_owner_id?: string | null
          email?: string
          expires_at?: string
          history_id?: string | null
          history_recovery_anchor?: string | null
          history_recovery_page_token?: string | null
          history_recovery_target_token?: string | null
          id?: string
          last_synced_at?: string | null
          ops_label_id?: string | null
          provider?: string
          refresh_token?: string
          status?: string
          sync_enabled?: boolean
          sync_filters?: Json
          sync_in_progress_at?: string | null
          sync_interval_minutes?: number
          sync_lock_owner?: string | null
          type?: Database["public"]["Enums"]["gmail_connection_type"]
          updated_at?: string | null
          user_id?: string | null
          webhook_expires_at?: string | null
          webhook_client_state_hash?: string | null
          webhook_subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_connections_default_intake_owner_id_fkey"
            columns: ["default_intake_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_oauth_states: {
        Row: {
          company_id: string
          connection_id: string | null
          connection_type: string
          created_at: string
          expected_email: string | null
          expires_at: string
          nonce_hash: string
          provider: string
          source: string
          user_id: string
        }
        Insert: {
          company_id: string
          connection_id?: string | null
          connection_type: string
          created_at?: string
          expected_email?: string | null
          expires_at: string
          nonce_hash: string
          provider: string
          source: string
          user_id: string
        }
        Update: {
          company_id?: string
          connection_id?: string | null
          connection_type?: string
          created_at?: string
          expected_email?: string | null
          expires_at?: string
          nonce_hash?: string
          provider?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_oauth_states_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_oauth_states_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_oauth_states_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbound_edit_evidence: {
        Row: {
          company_id: string
          created_at: string
          evidence_key: string
          evidence_kind: string
          from_value: string | null
          id: string
          learning_authority: string
          pattern_value: string
          profile_type: string
          queue_id: string
          source_type: string
          to_value: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          evidence_key: string
          evidence_kind: string
          from_value?: string | null
          id?: string
          learning_authority: string
          pattern_value: string
          profile_type: string
          queue_id: string
          source_type: string
          to_value: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          evidence_key?: string
          evidence_kind?: string
          from_value?: string | null
          id?: string
          learning_authority?: string
          pattern_value?: string
          profile_type?: string
          queue_id?: string
          source_type?: string
          to_value?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbound_edit_evidence_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_edit_evidence_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "email_outbound_learning_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_edit_evidence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbound_edit_promotions: {
        Row: {
          company_id: string
          evidence_count: number
          evidence_key: string
          evidence_kind: string
          id: string
          pattern_value: string
          profile_id: string
          profile_type: string
          promoted_at: string
          promoted_by_queue_id: string
          threshold: number
          user_id: string
        }
        Insert: {
          company_id: string
          evidence_count: number
          evidence_key: string
          evidence_kind: string
          id?: string
          pattern_value: string
          profile_id: string
          profile_type: string
          promoted_at?: string
          promoted_by_queue_id: string
          threshold: number
          user_id: string
        }
        Update: {
          company_id?: string
          evidence_count?: number
          evidence_key?: string
          evidence_kind?: string
          id?: string
          pattern_value?: string
          profile_id?: string
          profile_type?: string
          promoted_at?: string
          promoted_by_queue_id?: string
          threshold?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbound_edit_promotions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_edit_promotions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "agent_writing_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_edit_promotions_promoted_by_queue_id_fkey"
            columns: ["promoted_by_queue_id"]
            isOneToOne: false
            referencedRelation: "email_outbound_learning_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_edit_promotions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbound_learning_queue: {
        Row: {
          applied_at: string | null
          apply_full_body_learning: boolean | null
          apply_learning: boolean | null
          actor_proof_type: string | null
          approved_action_email_intent_id: string | null
          assignment_event_id_snapshot: string | null
          assignment_version_snapshot: number | null
          attempts: number
          authored_body: string
          clean_body: string
          company_id: string
          completed_at: string | null
          completed_lease_token: string | null
          connection_id: string
          created_at: string
          draft_correction_facts: Json | null
          draft_delivery_channel: string | null
          draft_history_id: string | null
          draft_outcome: Json | null
          email_send_intent_id: string | null
          follow_up_draft_id: string | null
          from_email: string | null
          id: string
          last_error: string | null
          last_failed_at: string | null
          last_requeue_reason: string | null
          last_requeued_at: string | null
          last_terminal_error: string | null
          learning_authority: string
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          memory_extraction: Json | null
          next_attempt_at: string
          occurred_at: string | null
          opportunity_id: string | null
          preparation_version: string | null
          prepared_at: string | null
          profile_type: string
          provider_message_id: string
          provider_thread_id: string | null
          requeue_count: number
          status: string
          subject: string
          to_emails: string[]
          updated_at: string
          user_id: string
          writing_sample: Json | null
        }
        Insert: {
          applied_at?: string | null
          apply_full_body_learning?: boolean | null
          apply_learning?: boolean | null
          actor_proof_type?: string | null
          approved_action_email_intent_id?: string | null
          assignment_event_id_snapshot?: string | null
          assignment_version_snapshot?: number | null
          attempts?: number
          authored_body: string
          clean_body: string
          company_id: string
          completed_at?: string | null
          completed_lease_token?: string | null
          connection_id: string
          created_at?: string
          draft_correction_facts?: Json | null
          draft_delivery_channel?: string | null
          draft_history_id?: string | null
          draft_outcome?: Json | null
          email_send_intent_id?: string | null
          follow_up_draft_id?: string | null
          from_email?: string | null
          id?: string
          last_error?: string | null
          last_failed_at?: string | null
          last_requeue_reason?: string | null
          last_requeued_at?: string | null
          last_terminal_error?: string | null
          learning_authority?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          memory_extraction?: Json | null
          next_attempt_at?: string
          occurred_at?: string | null
          opportunity_id?: string | null
          preparation_version?: string | null
          prepared_at?: string | null
          profile_type?: string
          provider_message_id: string
          provider_thread_id?: string | null
          requeue_count?: number
          status?: string
          subject?: string
          to_emails?: string[]
          updated_at?: string
          user_id: string
          writing_sample?: Json | null
        }
        Update: {
          applied_at?: string | null
          apply_full_body_learning?: boolean | null
          apply_learning?: boolean | null
          actor_proof_type?: string | null
          approved_action_email_intent_id?: string | null
          assignment_event_id_snapshot?: string | null
          assignment_version_snapshot?: number | null
          attempts?: number
          authored_body?: string
          clean_body?: string
          company_id?: string
          completed_at?: string | null
          completed_lease_token?: string | null
          connection_id?: string
          created_at?: string
          draft_correction_facts?: Json | null
          draft_delivery_channel?: string | null
          draft_history_id?: string | null
          draft_outcome?: Json | null
          email_send_intent_id?: string | null
          follow_up_draft_id?: string | null
          from_email?: string | null
          id?: string
          last_error?: string | null
          last_failed_at?: string | null
          last_requeue_reason?: string | null
          last_requeued_at?: string | null
          last_terminal_error?: string | null
          learning_authority?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          memory_extraction?: Json | null
          next_attempt_at?: string
          occurred_at?: string | null
          opportunity_id?: string | null
          preparation_version?: string | null
          prepared_at?: string | null
          profile_type?: string
          provider_message_id?: string
          provider_thread_id?: string | null
          requeue_count?: number
          status?: string
          subject?: string
          to_emails?: string[]
          updated_at?: string
          user_id?: string
          writing_sample?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbound_learning_queue_approved_action_email_intent_id_fkey"
            columns: ["approved_action_email_intent_id"]
            isOneToOne: false
            referencedRelation: "approved_action_email_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_learning_queue_assignment_event_id_snapshot_fkey"
            columns: ["assignment_event_id_snapshot"]
            isOneToOne: false
            referencedRelation: "opportunity_assignment_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_learning_queue_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_learning_queue_draft_history_id_fkey"
            columns: ["draft_history_id"]
            isOneToOne: false
            referencedRelation: "ai_draft_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_learning_queue_email_send_intent_id_fkey"
            columns: ["email_send_intent_id"]
            isOneToOne: false
            referencedRelation: "email_send_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_learning_queue_follow_up_draft_id_fkey"
            columns: ["follow_up_draft_id"]
            isOneToOne: false
            referencedRelation: "opportunity_follow_up_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_learning_queue_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbound_memory_evidence: {
        Row: {
          applied_at: string
          company_id: string
          connection_id: string
          effect: string
          evidence_key: string
          evidence_kind: string
          id: string
          knowledge_graph_id: string | null
          memory_id: string | null
          provider_message_id: string
          queue_id: string
          user_id: string
          writing_sample_id: string | null
        }
        Insert: {
          applied_at?: string
          company_id: string
          connection_id: string
          effect: string
          evidence_key: string
          evidence_kind: string
          id?: string
          knowledge_graph_id?: string | null
          memory_id?: string | null
          provider_message_id: string
          queue_id: string
          user_id: string
          writing_sample_id?: string | null
        }
        Update: {
          applied_at?: string
          company_id?: string
          connection_id?: string
          effect?: string
          evidence_key?: string
          evidence_kind?: string
          id?: string
          knowledge_graph_id?: string | null
          memory_id?: string | null
          provider_message_id?: string
          queue_id?: string
          user_id?: string
          writing_sample_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_outbound_memory_evidence_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_memory_evidence_knowledge_graph_id_fkey"
            columns: ["knowledge_graph_id"]
            isOneToOne: false
            referencedRelation: "agent_knowledge_graph"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_memory_evidence_memory_id_fkey"
            columns: ["memory_id"]
            isOneToOne: false
            referencedRelation: "agent_memories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_memory_evidence_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: false
            referencedRelation: "email_outbound_learning_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_memory_evidence_writing_sample_id_fkey"
            columns: ["writing_sample_id"]
            isOneToOne: false
            referencedRelation: "email_outbound_writing_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      email_outbound_writing_samples: {
        Row: {
          applied_at: string
          company_id: string
          connection_id: string
          id: string
          profile_id: string | null
          profile_type: string
          provider_message_id: string
          queue_id: string
          sample: Json
          user_id: string
        }
        Insert: {
          applied_at?: string
          company_id: string
          connection_id: string
          id?: string
          profile_id?: string | null
          profile_type: string
          provider_message_id: string
          queue_id: string
          sample: Json
          user_id: string
        }
        Update: {
          applied_at?: string
          company_id?: string
          connection_id?: string
          id?: string
          profile_id?: string | null
          profile_type?: string
          provider_message_id?: string
          queue_id?: string
          sample?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_outbound_writing_samples_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_writing_samples_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "agent_writing_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_outbound_writing_samples_queue_id_fkey"
            columns: ["queue_id"]
            isOneToOne: true
            referencedRelation: "email_outbound_learning_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      email_signature_notification_lifecycle_outbox: {
        Row: {
          actor_user_id: string
          attempt_count: number
          available_at: string
          company_id: string
          connection_id: string
          created_at: string
          last_error: string | null
          processed_at: string | null
          reason: string
          requested_at: string
        }
        Insert: {
          actor_user_id: string
          attempt_count?: number
          available_at?: string
          company_id: string
          connection_id: string
          created_at?: string
          last_error?: string | null
          processed_at?: string | null
          reason: string
          requested_at?: string
        }
        Update: {
          actor_user_id?: string
          attempt_count?: number
          available_at?: string
          company_id?: string
          connection_id?: string
          created_at?: string
          last_error?: string | null
          processed_at?: string | null
          reason?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_signature_notification_lifecycle_outbox_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_signature_notification_lifecycle_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_signature_notification_lifecycle_outbox_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      email_signatures: {
        Row: {
          active: boolean
          company_id: string
          confirmed_at: string | null
          connection_id: string
          content_hash: string
          content_html: string | null
          content_text: string | null
          created_at: string
          created_by: string | null
          fetched_at: string | null
          id: string
          provider_identity: string | null
          scope_user_id: string | null
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          company_id: string
          confirmed_at?: string | null
          connection_id: string
          content_hash: string
          content_html?: string | null
          content_text?: string | null
          created_at?: string
          created_by?: string | null
          fetched_at?: string | null
          id?: string
          provider_identity?: string | null
          scope_user_id?: string | null
          source: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          company_id?: string
          confirmed_at?: string | null
          connection_id?: string
          content_hash?: string
          content_html?: string | null
          content_text?: string | null
          created_at?: string
          created_by?: string | null
          fetched_at?: string | null
          id?: string
          provider_identity?: string | null
          scope_user_id?: string | null
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_signatures_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_signatures_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_signatures_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_signatures_scope_user_id_fkey"
            columns: ["scope_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_signatures_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          created_at: string | null
          email: string
          event: string
          id: string
          ip: string | null
          raw: Json | null
          reason: string | null
          sg_message_id: string | null
          timestamp: string
          url: string | null
          useragent: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          event: string
          id?: string
          ip?: string | null
          raw?: Json | null
          reason?: string | null
          sg_message_id?: string | null
          timestamp: string
          url?: string | null
          useragent?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          event?: string
          id?: string
          ip?: string | null
          raw?: Json | null
          reason?: string | null
          sg_message_id?: string | null
          timestamp?: string
          url?: string | null
          useragent?: string | null
        }
        Relationships: []
      }
      email_filter_presets: {
        Row: {
          category: string
          id: string
          type: string
          value: string
        }
        Insert: {
          category: string
          id?: string
          type: string
          value: string
        }
        Update: {
          category?: string
          id?: string
          type?: string
          value?: string
        }
        Relationships: []
      }
      email_ingest_heartbeat_log: {
        Row: {
          company_id: string
          id: string
          reason: string
          triggered_at: string
        }
        Insert: {
          company_id: string
          id?: string
          reason: string
          triggered_at?: string
        }
        Update: {
          company_id?: string
          id?: string
          reason?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_ingest_heartbeat_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_jobs: {
        Row: {
          campaign_id: string
          created_at: string
          event_count: number
          id: string
          last_error: string | null
          recipient_email: string
          recipient_user_id: string | null
          retry_count: number
          sent_at: string | null
          sg_message_id: string | null
          status: Database["public"]["Enums"]["email_job_status"]
          template_payload: Json
          template_version: string | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          event_count?: number
          id?: string
          last_error?: string | null
          recipient_email: string
          recipient_user_id?: string | null
          retry_count?: number
          sent_at?: string | null
          sg_message_id?: string | null
          status?: Database["public"]["Enums"]["email_job_status"]
          template_payload?: Json
          template_version?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          event_count?: number
          id?: string
          last_error?: string | null
          recipient_email?: string
          recipient_user_id?: string | null
          retry_count?: number
          sent_at?: string | null
          sg_message_id?: string | null
          status?: Database["public"]["Enums"]["email_job_status"]
          template_payload?: Json
          template_version?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      email_log: {
        Row: {
          campaign_id: string | null
          email_type: string
          error_message: string | null
          id: string
          metadata: Json | null
          recipient_email: string
          sent_at: string | null
          status: string | null
          subject: string | null
          template_version: string | null
          user_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          email_type: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient_email: string
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          template_version?: string | null
          user_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          email_type?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient_email?: string
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          template_version?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_log_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_pause_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string | null
          anomaly_log_id: string | null
          created_at: string
          id: string
          paused_until: string | null
          reason: string | null
          scope: string
          severity: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id?: string | null
          anomaly_log_id?: string | null
          created_at?: string
          id?: string
          paused_until?: string | null
          reason?: string | null
          scope: string
          severity?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string | null
          anomaly_log_id?: string | null
          created_at?: string
          id?: string
          paused_until?: string | null
          reason?: string | null
          scope?: string
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_pause_audit_log_anomaly_log_id_fkey"
            columns: ["anomaly_log_id"]
            isOneToOne: false
            referencedRelation: "email_anomaly_log"
            referencedColumns: ["id"]
          },
        ]
      }
      email_pause_state: {
        Row: {
          is_paused: boolean
          pause_reason: string | null
          paused_at: string | null
          paused_by: string | null
          paused_until: string | null
          resumed_at: string | null
          resumed_by: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          is_paused?: boolean
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_until?: string | null
          resumed_at?: string | null
          resumed_by?: string | null
          scope: string
          updated_at?: string
        }
        Update: {
          is_paused?: boolean
          pause_reason?: string | null
          paused_at?: string | null
          paused_by?: string | null
          paused_until?: string | null
          resumed_at?: string | null
          resumed_by?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          expires_at: string | null
          id: string
          list: string
          metadata: Json | null
          reason: string
          source: string
          source_event_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          list?: string
          metadata?: Json | null
          reason: string
          source: string
          source_event_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          list?: string
          metadata?: Json | null
          reason?: string
          source?: string
          source_event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_suppressions_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "email_events"
            referencedColumns: ["id"]
          },
        ]
      }
      email_template_versions: {
        Row: {
          content_hash: string
          created_at: string
          created_by_user_id: string | null
          id: string
          notes: string | null
          preview_props: Json | null
          rendered_sample_html: string | null
          template_id: string
          version: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          notes?: string | null
          preview_props?: Json | null
          rendered_sample_html?: string | null
          template_id: string
          version: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          notes?: string | null
          preview_props?: Json | null
          rendered_sample_html?: string | null
          template_id?: string
          version?: string
        }
        Relationships: []
      }
      email_templates: {
        Row: {
          body: string
          category: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          category?: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      email_thread_category_corrections: {
        Row: {
          applied_to_similar: boolean
          company_id: string
          created_at: string
          from_category: string
          id: string
          note: string | null
          participants_hash: string | null
          sender_domain: string | null
          sender_email: string | null
          similar_count: number
          subject_keywords: string[]
          thread_id: string
          to_category: string
          user_id: string
        }
        Insert: {
          applied_to_similar?: boolean
          company_id: string
          created_at?: string
          from_category: string
          id?: string
          note?: string | null
          participants_hash?: string | null
          sender_domain?: string | null
          sender_email?: string | null
          similar_count?: number
          subject_keywords?: string[]
          thread_id: string
          to_category: string
          user_id: string
        }
        Update: {
          applied_to_similar?: boolean
          company_id?: string
          created_at?: string
          from_category?: string
          id?: string
          note?: string | null
          participants_hash?: string | null
          sender_domain?: string | null
          sender_email?: string | null
          similar_count?: number
          subject_keywords?: string[]
          thread_id?: string
          to_category?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_thread_category_corrections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_category_corrections_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "email_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_thread_category_corrections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_threads: {
        Row: {
          agent_blocking_question: Json | null
          agent_paused_until: string | null
          ai_summary: string | null
          archived_at: string | null
          ball_settled_at: string | null
          category_classified_at: string | null
          category_classifier_version: string
          category_confidence: number
          category_manually_set: boolean
          client_id: string | null
          closed_opp_assessment: Json | null
          company_id: string
          connection_id: string
          created_at: string
          first_message_at: string
          has_unresolved_commitments: boolean
          id: string
          labels: string[]
          last_message_at: string
          latest_direction: string | null
          latest_sender_email: string | null
          latest_sender_name: string | null
          latest_snippet: string | null
          lead_scan_pending_at: string | null
          message_count: number
          next_commitment_due_at: string | null
          opportunity_id: string | null
          participants: string[]
          phase_c_extracted_at: string | null
          primary_category: string
          priority_score: number
          provider_thread_id: string
          snoozed_until: string | null
          subject: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          agent_blocking_question?: Json | null
          agent_paused_until?: string | null
          ai_summary?: string | null
          archived_at?: string | null
          ball_settled_at?: string | null
          category_classified_at?: string | null
          category_classifier_version?: string
          category_confidence?: number
          category_manually_set?: boolean
          client_id?: string | null
          closed_opp_assessment?: Json | null
          company_id: string
          connection_id: string
          created_at?: string
          first_message_at: string
          has_unresolved_commitments?: boolean
          id?: string
          labels?: string[]
          last_message_at: string
          latest_direction?: string | null
          latest_sender_email?: string | null
          latest_sender_name?: string | null
          latest_snippet?: string | null
          lead_scan_pending_at?: string | null
          message_count?: number
          next_commitment_due_at?: string | null
          opportunity_id?: string | null
          participants?: string[]
          phase_c_extracted_at?: string | null
          primary_category?: string
          priority_score?: number
          provider_thread_id: string
          snoozed_until?: string | null
          subject?: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          agent_blocking_question?: Json | null
          agent_paused_until?: string | null
          ai_summary?: string | null
          archived_at?: string | null
          ball_settled_at?: string | null
          category_classified_at?: string | null
          category_classifier_version?: string
          category_confidence?: number
          category_manually_set?: boolean
          client_id?: string | null
          closed_opp_assessment?: Json | null
          company_id?: string
          connection_id?: string
          created_at?: string
          first_message_at?: string
          has_unresolved_commitments?: boolean
          id?: string
          labels?: string[]
          last_message_at?: string
          latest_direction?: string | null
          latest_sender_email?: string | null
          latest_sender_name?: string | null
          latest_snippet?: string | null
          lead_scan_pending_at?: string | null
          message_count?: number
          next_commitment_due_at?: string | null
          opportunity_id?: string | null
          participants?: string[]
          phase_c_extracted_at?: string | null
          primary_category?: string
          priority_score?: number
          provider_thread_id?: string
          snoozed_until?: string | null
          subject?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_threads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_threads_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          completed_at: string | null
          course_id: string
          enrolled_at: string
          id: string
          status: Database["public"]["Enums"]["enrollment_status"]
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          course_id: string
          enrolled_at?: string
          id?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          user_id: string
        }
        Update: {
          completed_at?: string | null
          course_id?: string
          enrolled_at?: string
          id?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          approved_at: string | null
          client_id: string
          client_message: string | null
          client_ref: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deposit_amount: number | null
          deposit_type: string | null
          deposit_value: number | null
          discount_amount: number
          discount_type: string | null
          discount_value: number | null
          estimate_number: string
          expiration_date: string | null
          id: string
          internal_notes: string | null
          issue_date: string
          opportunity_id: string | null
          parent_id: string | null
          pdf_storage_path: string | null
          project_id: string | null
          project_ref: string | null
          qb_id: string | null
          sage_id: string | null
          sent_at: string | null
          status: string
          subtotal: number
          tax_amount: number
          tax_rate: number | null
          template_id: string | null
          terms: string | null
          title: string | null
          total: number
          updated_at: string
          version: number
          viewed_at: string | null
        }
        Insert: {
          approved_at?: string | null
          client_id: string
          client_message?: string | null
          client_ref?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_type?: string | null
          deposit_value?: number | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number | null
          estimate_number: string
          expiration_date?: string | null
          id?: string
          internal_notes?: string | null
          issue_date?: string
          opportunity_id?: string | null
          parent_id?: string | null
          pdf_storage_path?: string | null
          project_id?: string | null
          project_ref?: string | null
          qb_id?: string | null
          sage_id?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number | null
          template_id?: string | null
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          version?: number
          viewed_at?: string | null
        }
        Update: {
          approved_at?: string | null
          client_id?: string
          client_message?: string | null
          client_ref?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deposit_amount?: number | null
          deposit_type?: string | null
          deposit_value?: number | null
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number | null
          estimate_number?: string
          expiration_date?: string | null
          id?: string
          internal_notes?: string | null
          issue_date?: string
          opportunity_id?: string | null
          parent_id?: string | null
          pdf_storage_path?: string | null
          project_id?: string | null
          project_ref?: string | null
          qb_id?: string | null
          sage_id?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number | null
          template_id?: string | null
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          version?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_client_ref_fkey"
            columns: ["client_ref"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_auto_approve_rule_members: {
        Row: {
          id: string
          rule_id: string
          user_id: string
        }
        Insert: {
          id?: string
          rule_id: string
          user_id: string
        }
        Update: {
          id?: string
          rule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_auto_approve_rule_members_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "expense_auto_approve_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_auto_approve_rule_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_auto_approve_rules: {
        Row: {
          applies_to_all: boolean
          company_id: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          rule_type: string
          threshold_amount: number
          updated_at: string
        }
        Insert: {
          applies_to_all?: boolean
          company_id: string
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          rule_type: string
          threshold_amount: number
          updated_at?: string
        }
        Update: {
          applies_to_all?: boolean
          company_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          rule_type?: string
          threshold_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_auto_approve_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_auto_approve_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_batches: {
        Row: {
          amendment_number: number
          approved_amount: number | null
          batch_number: string
          company_id: string
          created_at: string | null
          id: string
          parent_batch_id: string | null
          period_end: string | null
          period_start: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scope_project_id: string | null
          status: string
          submitted_by: string | null
          total_amount: number | null
        }
        Insert: {
          amendment_number?: number
          approved_amount?: number | null
          batch_number: string
          company_id: string
          created_at?: string | null
          id?: string
          parent_batch_id?: string | null
          period_end?: string | null
          period_start?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_project_id?: string | null
          status?: string
          submitted_by?: string | null
          total_amount?: number | null
        }
        Update: {
          amendment_number?: number
          approved_amount?: number | null
          batch_number?: string
          company_id?: string
          created_at?: string | null
          id?: string
          parent_batch_id?: string | null
          period_end?: string | null
          period_start?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_project_id?: string | null
          status?: string
          submitted_by?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_batches_parent_batch_id_fkey"
            columns: ["parent_batch_id"]
            isOneToOne: false
            referencedRelation: "expense_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_categories: {
        Row: {
          company_id: string
          created_at: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          sort_order: number | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          sort_order?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      expense_project_allocations: {
        Row: {
          amount: number | null
          expense_id: string
          id: string
          percentage: number
          project_id: string
        }
        Insert: {
          amount?: number | null
          expense_id: string
          id?: string
          percentage: number
          project_id: string
        }
        Update: {
          amount?: number | null
          expense_id?: string
          id?: string
          percentage?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_project_allocations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_settings: {
        Row: {
          admin_approval_threshold: number | null
          auto_approve_threshold: number | null
          auto_submit_grace_days: number
          company_id: string
          created_at: string | null
          forecast_balance_updated_at: string | null
          forecast_current_balance: number | null
          forecast_low_water_threshold: number | null
          id: string
          require_project_assignment: boolean | null
          require_receipt_photo: boolean | null
          review_frequency: string | null
          updated_at: string | null
        }
        Insert: {
          admin_approval_threshold?: number | null
          auto_approve_threshold?: number | null
          auto_submit_grace_days?: number
          company_id: string
          created_at?: string | null
          forecast_balance_updated_at?: string | null
          forecast_current_balance?: number | null
          forecast_low_water_threshold?: number | null
          id?: string
          require_project_assignment?: boolean | null
          require_receipt_photo?: boolean | null
          review_frequency?: string | null
          updated_at?: string | null
        }
        Update: {
          admin_approval_threshold?: number | null
          auto_approve_threshold?: number | null
          auto_submit_grace_days?: number
          company_id?: string
          created_at?: string | null
          forecast_balance_updated_at?: string | null
          forecast_current_balance?: number | null
          forecast_low_water_threshold?: number | null
          id?: string
          require_project_assignment?: boolean | null
          require_receipt_photo?: boolean | null
          review_frequency?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          accounting_sync_id: string | null
          accounting_sync_status: string | null
          accounting_synced_at: string | null
          amount: number
          approved_at: string | null
          approved_by: string | null
          batch_id: string | null
          category_id: string | null
          company_id: string
          created_at: string | null
          currency: string | null
          deleted_at: string | null
          description: string | null
          expense_date: string | null
          flag_comment: string | null
          flagged_at: string | null
          flagged_by: string | null
          id: string
          merchant_name: string | null
          ocr_confidence: number | null
          ocr_raw_data: Json | null
          payment_method: string | null
          receipt_image_url: string | null
          receipt_thumbnail_url: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: string
          submitted_by: string
          tax_amount: number | null
          updated_at: string | null
        }
        Insert: {
          accounting_sync_id?: string | null
          accounting_sync_status?: string | null
          accounting_synced_at?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          batch_id?: string | null
          category_id?: string | null
          company_id: string
          created_at?: string | null
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          expense_date?: string | null
          flag_comment?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
          merchant_name?: string | null
          ocr_confidence?: number | null
          ocr_raw_data?: Json | null
          payment_method?: string | null
          receipt_image_url?: string | null
          receipt_thumbnail_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_by: string
          tax_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          accounting_sync_id?: string | null
          accounting_sync_status?: string | null
          accounting_synced_at?: string | null
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          batch_id?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string | null
          currency?: string | null
          deleted_at?: string | null
          description?: string | null
          expense_date?: string | null
          flag_comment?: string | null
          flagged_at?: string | null
          flagged_by?: string | null
          id?: string
          merchant_name?: string | null
          ocr_confidence?: number | null
          ocr_raw_data?: Json | null
          payment_method?: string | null
          receipt_image_url?: string | null
          receipt_thumbnail_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string
          submitted_by?: string
          tax_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "expense_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_flagged_by_fkey"
            columns: ["flagged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flag_overrides: {
        Row: {
          created_at: string | null
          flag_slug: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          flag_slug: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          flag_slug?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flag_overrides_flag_slug_fkey"
            columns: ["flag_slug"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["slug"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string | null
          description: string | null
          enabled: boolean
          label: string
          permissions: string[] | null
          routes: string[] | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean
          label: string
          permissions?: string[] | null
          routes?: string[] | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean
          label?: string
          permissions?: string[] | null
          routes?: string[] | null
          slug?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      feature_requests: {
        Row: {
          app_version: string | null
          company_id: string | null
          created_at: string | null
          description: string
          id: string
          platform: string | null
          source_screen: string | null
          status: string | null
          title: string | null
          type: string
          updated_at: string | null
          user_email: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          app_version?: string | null
          company_id?: string | null
          created_at?: string | null
          description: string
          id?: string
          platform?: string | null
          source_screen?: string | null
          status?: string | null
          title?: string | null
          type: string
          updated_at?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          app_version?: string | null
          company_id?: string | null
          created_at?: string | null
          description?: string
          id?: string
          platform?: string | null
          source_screen?: string | null
          status?: string | null
          title?: string | null
          type?: string
          updated_at?: string | null
          user_email?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          company_id: string
          completed_at: string | null
          completion_notes: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string
          id: string
          is_auto_generated: boolean | null
          opportunity_id: string | null
          reminder_at: string | null
          status: string
          title: string
          trigger_source: string | null
          type: string
        }
        Insert: {
          assigned_to?: string | null
          client_id?: string | null
          company_id: string
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at: string
          id?: string
          is_auto_generated?: boolean | null
          opportunity_id?: string | null
          reminder_at?: string | null
          status?: string
          title: string
          trigger_source?: string | null
          type: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string | null
          company_id?: string
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string
          id?: string
          is_auto_generated?: boolean | null
          opportunity_id?: string | null
          reminder_at?: string | null
          status?: string
          title?: string
          trigger_source?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_alerts: {
        Row: {
          company_id: string
          dismissed_until_balance: number | null
          last_cleared_at: string | null
          last_dip_min_balance: number | null
          last_dip_min_week_start: string | null
          last_dip_notified_at: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          dismissed_until_balance?: number | null
          last_cleared_at?: string | null
          last_dip_min_balance?: number | null
          last_dip_min_week_start?: string | null
          last_dip_notified_at?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          dismissed_until_balance?: number | null
          last_cleared_at?: string | null
          last_dip_min_balance?: number | null
          last_dip_min_week_start?: string | null
          last_dip_notified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_import_jobs: {
        Row: {
          clients_created: number | null
          company_id: string
          completed_at: string | null
          connection_id: string
          created_at: string
          error_message: string | null
          id: string
          import_after: string
          leads_created: number | null
          matched: number
          needs_review: number
          processed: number
          status: string
          total_emails: number
          unmatched: number
        }
        Insert: {
          clients_created?: number | null
          company_id: string
          completed_at?: string | null
          connection_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          import_after: string
          leads_created?: number | null
          matched?: number
          needs_review?: number
          processed?: number
          status?: string
          total_emails?: number
          unmatched?: number
        }
        Update: {
          clients_created?: number | null
          company_id?: string
          completed_at?: string | null
          connection_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          import_after?: string
          leads_created?: number | null
          matched?: number
          needs_review?: number
          processed?: number
          status?: string
          total_emails?: number
          unmatched?: number
        }
        Relationships: [
          {
            foreignKeyName: "gmail_import_jobs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_scan_jobs: {
        Row: {
          company_id: string
          connection_owner_user_id: string | null
          connection_id: string
          created_at: string | null
          error_message: string | null
          id: string
          phase_c_lock_expires_at: string | null
          phase_c_lock_holder_id: string | null
          progress: Json | null
          requested_by_user_id: string | null
          result: Json | null
          status: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          connection_owner_user_id?: string | null
          connection_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          phase_c_lock_expires_at?: string | null
          phase_c_lock_holder_id?: string | null
          progress?: Json | null
          requested_by_user_id?: string | null
          result?: Json | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          connection_owner_user_id?: string | null
          connection_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          phase_c_lock_expires_at?: string | null
          phase_c_lock_holder_id?: string | null
          progress?: Json | null
          requested_by_user_id?: string | null
          result?: Json | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gmail_scan_jobs_connection_owner_user_id_fkey"
            columns: ["connection_owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gmail_scan_jobs_requested_by_user_id_fkey"
            columns: ["requested_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      graph_entities: {
        Row: {
          company_id: string
          confidence: number | null
          created_at: string | null
          email: string | null
          embedding: string | null
          entity_type: string
          id: string
          name: string
          normalized_name: string
          properties: Json | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          confidence?: number | null
          created_at?: string | null
          email?: string | null
          embedding?: string | null
          entity_type: string
          id?: string
          name: string
          normalized_name: string
          properties?: Json | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          confidence?: number | null
          created_at?: string | null
          email?: string | null
          embedding?: string | null
          entity_type?: string
          id?: string
          name?: string
          normalized_name?: string
          properties?: Json | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graph_entities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_deductions: {
        Row: {
          catalog_variant_id: string | null
          company_id: string
          deducted_at: string
          deducted_by: string | null
          id: string
          inventory_item_id: string | null
          line_item_id: string | null
          new_quantity: number
          notes: string | null
          previous_quantity: number
          project_id: string | null
          quantity_deducted: number
          reason: string
          task_id: string | null
        }
        Insert: {
          catalog_variant_id?: string | null
          company_id: string
          deducted_at?: string
          deducted_by?: string | null
          id?: string
          inventory_item_id?: string | null
          line_item_id?: string | null
          new_quantity: number
          notes?: string | null
          previous_quantity: number
          project_id?: string | null
          quantity_deducted: number
          reason?: string
          task_id?: string | null
        }
        Update: {
          catalog_variant_id?: string | null
          company_id?: string
          deducted_at?: string
          deducted_by?: string | null
          id?: string
          inventory_item_id?: string | null
          line_item_id?: string | null
          new_quantity?: number
          notes?: string | null
          previous_quantity?: number
          project_id?: string | null
          quantity_deducted?: number
          reason?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_deductions_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_deductions_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "inventory_deductions_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_deductions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_deductions_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_deductions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_deductions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_deductions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          balance_due: number
          client_id: string
          client_message: string | null
          client_ref: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deposit_applied: number
          discount_amount: number
          discount_type: string | null
          discount_value: number | null
          due_date: string
          estimate_id: string | null
          footer: string | null
          id: string
          internal_notes: string | null
          invoice_number: string
          issue_date: string
          opportunity_id: string | null
          paid_at: string | null
          payment_terms: string | null
          pdf_storage_path: string | null
          project_id: string | null
          project_ref: string | null
          qb_id: string | null
          sage_id: string | null
          sent_at: string | null
          status: string
          subject: string | null
          subtotal: number
          tax_amount: number
          tax_rate: number | null
          template_id: string | null
          terms: string | null
          total: number
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          amount_paid?: number
          balance_due?: number
          client_id: string
          client_message?: string | null
          client_ref?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deposit_applied?: number
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number | null
          due_date: string
          estimate_id?: string | null
          footer?: string | null
          id?: string
          internal_notes?: string | null
          invoice_number: string
          issue_date?: string
          opportunity_id?: string | null
          paid_at?: string | null
          payment_terms?: string | null
          pdf_storage_path?: string | null
          project_id?: string | null
          project_ref?: string | null
          qb_id?: string | null
          sage_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          subtotal?: number
          tax_amount?: number
          tax_rate?: number | null
          template_id?: string | null
          terms?: string | null
          total?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          amount_paid?: number
          balance_due?: number
          client_id?: string
          client_message?: string | null
          client_ref?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deposit_applied?: number
          discount_amount?: number
          discount_type?: string | null
          discount_value?: number | null
          due_date?: string
          estimate_id?: string | null
          footer?: string | null
          id?: string
          internal_notes?: string | null
          invoice_number?: string
          issue_date?: string
          opportunity_id?: string | null
          paid_at?: string | null
          payment_terms?: string | null
          pdf_storage_path?: string | null
          project_id?: string | null
          project_ref?: string | null
          qb_id?: string | null
          sage_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          subtotal?: number
          tax_amount?: number
          tax_rate?: number | null
          template_id?: string | null
          terms?: string | null
          total?: number
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_ref_fkey"
            columns: ["client_ref"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "document_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_field_provenance: {
        Row: {
          actor_user_id: string | null
          company_id: string
          confidence: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          entity_id: string
          entity_type: string
          extracted_at: string
          field_name: string
          id: string
          provider_message_id: string | null
          provider_thread_id: string | null
          source: string
          updated_at: string
          value_snapshot: string | null
        }
        Insert: {
          actor_user_id?: string | null
          company_id: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          extracted_at?: string
          field_name: string
          id?: string
          provider_message_id?: string | null
          provider_thread_id?: string | null
          source: string
          updated_at?: string
          value_snapshot?: string | null
        }
        Update: {
          actor_user_id?: string | null
          company_id?: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          extracted_at?: string
          field_name?: string
          id?: string
          provider_message_id?: string | null
          provider_thread_id?: string | null
          source?: string
          updated_at?: string
          value_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_field_provenance_actor_user_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_field_provenance_company_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_field_provenance_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_lifecycle_settings: {
        Row: {
          auto_archive_enabled: boolean
          auto_lost_enabled: boolean
          company_id: string
          created_at: string
          follow_up_after_days: number
          follow_up_template_body: string
          follow_up_template_subject: string
          inbound_unreplied_lost_days: number
          no_correspondence_archive_days: number
          second_follow_up_archive_after_days: number
          updated_at: string
        }
        Insert: {
          auto_archive_enabled?: boolean
          auto_lost_enabled?: boolean
          company_id: string
          created_at?: string
          follow_up_after_days?: number
          follow_up_template_body?: string
          follow_up_template_subject?: string
          inbound_unreplied_lost_days?: number
          no_correspondence_archive_days?: number
          second_follow_up_archive_after_days?: number
          updated_at?: string
        }
        Update: {
          auto_archive_enabled?: boolean
          auto_lost_enabled?: boolean
          company_id?: string
          created_at?: string
          follow_up_after_days?: number
          follow_up_template_body?: string
          follow_up_template_subject?: string
          inbound_unreplied_lost_days?: number
          no_correspondence_archive_days?: number
          second_follow_up_archive_after_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_lifecycle_settings_company_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string | null
          id: string
          last_position_seconds: number
          lesson_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["lesson_progress_status"]
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          id?: string
          last_position_seconds?: number
          lesson_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["lesson_progress_status"]
          user_id: string
        }
        Update: {
          completed_at?: string | null
          id?: string
          last_position_seconds?: number
          lesson_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["lesson_progress_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number | null
          id: string
          is_preview: boolean
          module_id: string
          slug: string
          sort_order: number
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_preview?: boolean
          module_id: string
          slug: string
          sort_order?: number
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number | null
          id?: string
          is_preview?: boolean
          module_id?: string
          slug?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_email_config: {
        Row: {
          email_type_key: string
          enabled: boolean
          max_days: number
          min_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          email_type_key: string
          enabled?: boolean
          max_days: number
          min_days: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          email_type_key?: string
          enabled?: boolean
          max_days?: number
          min_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      line_item_answers: {
        Row: {
          answer_value: string
          answered_at: string
          client_id: string
          id: string
          question_id: string
        }
        Insert: {
          answer_value: string
          answered_at?: string
          client_id: string
          id?: string
          question_id: string
        }
        Update: {
          answer_value?: string
          answered_at?: string
          client_id?: string
          id?: string
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_item_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "line_item_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      line_item_materials: {
        Row: {
          catalog_variant_id: string | null
          id: string
          inventory_item_id: string | null
          line_item_id: string
          quantity: number
          source: string
        }
        Insert: {
          catalog_variant_id?: string | null
          id?: string
          inventory_item_id?: string | null
          line_item_id: string
          quantity: number
          source?: string
        }
        Update: {
          catalog_variant_id?: string | null
          id?: string
          inventory_item_id?: string | null
          line_item_id?: string
          quantity?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "line_item_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_item_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "line_item_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_item_materials_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      line_item_questions: {
        Row: {
          answer_type: string
          company_id: string
          created_at: string
          estimate_id: string
          id: string
          is_required: boolean
          line_item_id: string
          options: Json | null
          question_text: string
          sort_order: number
        }
        Insert: {
          answer_type?: string
          company_id: string
          created_at?: string
          estimate_id: string
          id?: string
          is_required?: boolean
          line_item_id: string
          options?: Json | null
          question_text: string
          sort_order?: number
        }
        Update: {
          answer_type?: string
          company_id?: string
          created_at?: string
          estimate_id?: string
          id?: string
          is_required?: boolean
          line_item_id?: string
          options?: Json | null
          question_text?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "line_item_questions_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_item_questions_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "line_items"
            referencedColumns: ["id"]
          },
        ]
      }
      line_items: {
        Row: {
          category: string | null
          company_id: string
          configured_options: Json | null
          created_at: string | null
          description: string | null
          discount_percent: number | null
          estimate_id: string | null
          estimated_hours: number | null
          id: string
          invoice_id: string | null
          is_optional: boolean | null
          is_selected: boolean | null
          is_taxable: boolean | null
          line_total: number | null
          name: string
          parent_line_item_id: string | null
          product_id: string | null
          quantity: number
          resolved_options_label: string | null
          resolved_unit_price: number | null
          service_date: string | null
          sort_order: number
          task_type_id: string | null
          task_type_ref: string | null
          tax_rate_id: string | null
          type: string
          unit: string | null
          unit_cost: number | null
          unit_id: string | null
          unit_price: number
        }
        Insert: {
          category?: string | null
          company_id: string
          configured_options?: Json | null
          created_at?: string | null
          description?: string | null
          discount_percent?: number | null
          estimate_id?: string | null
          estimated_hours?: number | null
          id?: string
          invoice_id?: string | null
          is_optional?: boolean | null
          is_selected?: boolean | null
          is_taxable?: boolean | null
          line_total?: number | null
          name: string
          parent_line_item_id?: string | null
          product_id?: string | null
          quantity?: number
          resolved_options_label?: string | null
          resolved_unit_price?: number | null
          service_date?: string | null
          sort_order?: number
          task_type_id?: string | null
          task_type_ref?: string | null
          tax_rate_id?: string | null
          type?: string
          unit?: string | null
          unit_cost?: number | null
          unit_id?: string | null
          unit_price?: number
        }
        Update: {
          category?: string | null
          company_id?: string
          configured_options?: Json | null
          created_at?: string | null
          description?: string | null
          discount_percent?: number | null
          estimate_id?: string | null
          estimated_hours?: number | null
          id?: string
          invoice_id?: string | null
          is_optional?: boolean | null
          is_selected?: boolean | null
          is_taxable?: boolean | null
          line_total?: number | null
          name?: string
          parent_line_item_id?: string | null
          product_id?: string | null
          quantity?: number
          resolved_options_label?: string | null
          resolved_unit_price?: number | null
          service_date?: string | null
          sort_order?: number
          task_type_id?: string | null
          task_type_ref?: string | null
          tax_rate_id?: string | null
          type?: string
          unit?: string | null
          unit_cost?: number | null
          unit_id?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_items_parent_line_item_id_fkey"
            columns: ["parent_line_item_id"]
            isOneToOne: false
            referencedRelation: "line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_items_task_type_ref_fkey"
            columns: ["task_type_ref"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "line_items_tax_rate_id_fkey"
            columns: ["tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      location_history: {
        Row: {
          created_at: string
          heading: number | null
          id: number
          lat: number
          lng: number
          org_id: string
          recorded_at: string
          session_id: string | null
          speed: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          heading?: number | null
          id?: number
          lat: number
          lng: number
          org_id: string
          recorded_at: string
          session_id?: string | null
          speed?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          heading?: number | null
          id?: number
          lat?: number
          lng?: number
          org_id?: string
          recorded_at?: string
          session_id?: string | null
          speed?: number | null
          user_id?: string
        }
        Relationships: []
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          id: string
          sort_order: number
          title: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          id?: string
          sort_order?: number
          title: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      newsletter_content: {
        Row: {
          bug_fixes: string[] | null
          coming_up: string[] | null
          created_at: string
          custom_intro: string | null
          custom_outro: string | null
          id: string
          in_progress: string[] | null
          month: number
          shipped: string[] | null
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          bug_fixes?: string[] | null
          coming_up?: string[] | null
          created_at?: string
          custom_intro?: string | null
          custom_outro?: string | null
          id?: string
          in_progress?: string[] | null
          month: number
          shipped?: string[] | null
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          bug_fixes?: string[] | null
          coming_up?: string[] | null
          created_at?: string
          custom_intro?: string | null
          custom_outro?: string | null
          id?: string
          in_progress?: string[] | null
          month?: number
          shipped?: string[] | null
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      newsletter_subscribers: {
        Row: {
          consent_at: string | null
          consent_ip: string | null
          consent_source: string | null
          email: string
          first_name: string | null
          id: string
          is_active: boolean
          source: string | null
          subscribed_at: string
          unsubscribed_at: string | null
        }
        Insert: {
          consent_at?: string | null
          consent_ip?: string | null
          consent_source?: string | null
          email: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          source?: string | null
          subscribed_at?: string
          unsubscribed_at?: string | null
        }
        Update: {
          consent_at?: string | null
          consent_ip?: string | null
          consent_source?: string | null
          email?: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          source?: string | null
          subscribed_at?: string
          unsubscribed_at?: string | null
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          channel_preferences: Json | null
          company_id: string
          created_at: string | null
          daily_digest: boolean | null
          email_enabled: boolean | null
          expense_approved: boolean | null
          expense_submitted: boolean | null
          id: string
          invoice_sent: boolean | null
          payment_received: boolean | null
          project_updates: boolean | null
          push_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          schedule_changes: boolean | null
          task_assigned: boolean | null
          task_completed: boolean | null
          team_mentions: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          channel_preferences?: Json | null
          company_id: string
          created_at?: string | null
          daily_digest?: boolean | null
          email_enabled?: boolean | null
          expense_approved?: boolean | null
          expense_submitted?: boolean | null
          id?: string
          invoice_sent?: boolean | null
          payment_received?: boolean | null
          project_updates?: boolean | null
          push_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          schedule_changes?: boolean | null
          task_assigned?: boolean | null
          task_completed?: boolean | null
          team_mentions?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          channel_preferences?: Json | null
          company_id?: string
          created_at?: string | null
          daily_digest?: boolean | null
          email_enabled?: boolean | null
          expense_approved?: boolean | null
          expense_submitted?: boolean | null
          id?: string
          invoice_sent?: boolean | null
          payment_received?: boolean | null
          project_updates?: boolean | null
          push_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          schedule_changes?: boolean | null
          task_assigned?: boolean | null
          task_completed?: boolean | null
          team_mentions?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_label: string | null
          action_url: string | null
          batch_id: string | null
          body: string
          company_id: string
          created_at: string
          dedupe_key: string | null
          deep_link_type: string | null
          expense_id: string | null
          id: string
          incident_version: number
          is_read: boolean
          note_id: string | null
          persistent: boolean | null
          project_id: string | null
          resolution_reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          batch_id?: string | null
          body: string
          company_id: string
          created_at?: string
          dedupe_key?: string | null
          deep_link_type?: string | null
          expense_id?: string | null
          id?: string
          incident_version?: number
          is_read?: boolean
          note_id?: string | null
          persistent?: boolean | null
          project_id?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          batch_id?: string | null
          body?: string
          company_id?: string
          created_at?: string
          dedupe_key?: string | null
          deep_link_type?: string | null
          expense_id?: string | null
          id?: string
          incident_version?: number
          is_read?: boolean
          note_id?: string | null
          persistent?: boolean | null
          project_id?: string | null
          resolution_reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_analytics: {
        Row: {
          action: string
          created_at: string | null
          device_id: string
          flow_type: string
          id: string
          metadata: Json | null
          session_id: string
          step_name: string
          user_id: string | null
          variant: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          device_id: string
          flow_type: string
          id?: string
          metadata?: Json | null
          session_id: string
          step_name: string
          user_id?: string | null
          variant?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          device_id?: string
          flow_type?: string
          id?: string
          metadata?: Json | null
          session_id?: string
          step_name?: string
          user_id?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      onboarding_email_log: {
        Row: {
          attempts: number
          branch: string | null
          company_id: string
          created_at: string
          day_slot: string
          day_slot_expires_at: string
          email_type: string
          id: string
          last_error: string | null
          sent_at: string | null
          sg_message_id: string | null
          status: Database["public"]["Enums"]["onboarding_email_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          branch?: string | null
          company_id: string
          created_at?: string
          day_slot: string
          day_slot_expires_at: string
          email_type: string
          id?: string
          last_error?: string | null
          sent_at?: string | null
          sg_message_id?: string | null
          status?: Database["public"]["Enums"]["onboarding_email_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          branch?: string | null
          company_id?: string
          created_at?: string
          day_slot?: string
          day_slot_expires_at?: string
          email_type?: string
          id?: string
          last_error?: string | null
          sent_at?: string | null
          sg_message_id?: string | null
          status?: Database["public"]["Enums"]["onboarding_email_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_email_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_email_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_events: {
        Row: {
          created_at: string | null
          decision: string | null
          event_type: string
          id: string
          metadata: Json | null
          step: string | null
          user_id: string | null
          variant: string | null
        }
        Insert: {
          created_at?: string | null
          decision?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          step?: string | null
          user_id?: string | null
          variant?: string | null
        }
        Update: {
          created_at?: string | null
          decision?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          step?: string | null
          user_id?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      opportunities: {
        Row: {
          actual_close_date: string | null
          actual_value: number | null
          address: string | null
          ai_stage_confidence: number | null
          ai_stage_signals: string[] | null
          ai_summary: string | null
          ai_summary_updated_at: string | null
          archived_at: string | null
          assigned_to: string | null
          assignment_version: number
          client_id: string | null
          client_ref: string | null
          company_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          correspondence_count: number
          created_at: string
          deleted_at: string | null
          description: string | null
          detected_value: number | null
          estimated_value: number | null
          expected_close_date: string | null
          id: string
          images: string[] | null
          inbound_count: number
          last_activity_at: string | null
          last_inbound_at: string | null
          last_message_direction: string | null
          last_outbound_at: string | null
          handled_at: string | null
          latitude: number | null
          longitude: number | null
          lost_notes: string | null
          lost_reason: string | null
          merged_into_opportunity_id: string | null
          next_follow_up_at: string | null
          outbound_count: number
          priority: string | null
          project_id: string | null
          project_ref: string | null
          quote_delivery_method: string | null
          source: string | null
          source_email_id: string | null
          source_message_id: string | null
          source_metadata: Json | null
          stage: string
          stage_entered_at: string
          stage_manually_set: boolean
          tags: string[] | null
          title: string
          updated_at: string
          win_probability: number | null
        }
        Insert: {
          actual_close_date?: string | null
          actual_value?: number | null
          address?: string | null
          ai_stage_confidence?: number | null
          ai_stage_signals?: string[] | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          archived_at?: string | null
          assigned_to?: string | null
          assignment_version?: number
          client_id?: string | null
          client_ref?: string | null
          company_id: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          correspondence_count?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          detected_value?: number | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          images?: string[] | null
          inbound_count?: number
          last_activity_at?: string | null
          last_inbound_at?: string | null
          last_message_direction?: string | null
          last_outbound_at?: string | null
          handled_at?: string | null
          latitude?: number | null
          longitude?: number | null
          lost_notes?: string | null
          lost_reason?: string | null
          merged_into_opportunity_id?: string | null
          next_follow_up_at?: string | null
          outbound_count?: number
          priority?: string | null
          project_id?: string | null
          project_ref?: string | null
          quote_delivery_method?: string | null
          source?: string | null
          source_email_id?: string | null
          source_message_id?: string | null
          source_metadata?: Json | null
          stage?: string
          stage_entered_at?: string
          stage_manually_set?: boolean
          tags?: string[] | null
          title: string
          updated_at?: string
          win_probability?: number | null
        }
        Update: {
          actual_close_date?: string | null
          actual_value?: number | null
          address?: string | null
          ai_stage_confidence?: number | null
          ai_stage_signals?: string[] | null
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          archived_at?: string | null
          assigned_to?: string | null
          assignment_version?: number
          client_id?: string | null
          client_ref?: string | null
          company_id?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          correspondence_count?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          detected_value?: number | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          images?: string[] | null
          inbound_count?: number
          last_activity_at?: string | null
          last_inbound_at?: string | null
          last_message_direction?: string | null
          last_outbound_at?: string | null
          handled_at?: string | null
          latitude?: number | null
          longitude?: number | null
          lost_notes?: string | null
          lost_reason?: string | null
          merged_into_opportunity_id?: string | null
          next_follow_up_at?: string | null
          outbound_count?: number
          priority?: string | null
          project_id?: string | null
          project_ref?: string | null
          quote_delivery_method?: string | null
          source?: string | null
          source_email_id?: string | null
          source_message_id?: string | null
          source_metadata?: Json | null
          stage?: string
          stage_entered_at?: string
          stage_manually_set?: boolean
          tags?: string[] | null
          title?: string
          updated_at?: string
          win_probability?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_client_ref_fkey"
            columns: ["client_ref"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_merged_into_opportunity_id_fkey"
            columns: ["merged_into_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_conversion_notification_deliveries: {
        Row: {
          actor_user_id: string | null
          assignment_version: number
          attempts: number
          available_at: string
          claimed_at: string | null
          claimed_by: string | null
          company_id: string
          conversion_event_id: string
          created_at: string
          delivered_at: string | null
          destination: string | null
          disposition: string | null
          event_created_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          notification_id: string | null
          opportunity_id: string
          project_id: string
          push_state: string
          recipient_user_id: string
          state: string
          terminal_at: string | null
          updated_at: string
        }
        Insert: {
          actor_user_id?: string | null
          assignment_version: number
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          company_id: string
          conversion_event_id: string
          created_at?: string
          delivered_at?: string | null
          destination?: string | null
          disposition?: string | null
          event_created_at: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          notification_id?: string | null
          opportunity_id: string
          project_id: string
          push_state?: string
          recipient_user_id: string
          state?: string
          terminal_at?: string | null
          updated_at?: string
        }
        Update: {
          actor_user_id?: string | null
          assignment_version?: number
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          company_id?: string
          conversion_event_id?: string
          created_at?: string
          delivered_at?: string | null
          destination?: string | null
          disposition?: string | null
          event_created_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          notification_id?: string | null
          opportunity_id?: string
          project_id?: string
          push_state?: string
          recipient_user_id?: string
          state?: string
          terminal_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_conversion_notification_deliveries_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_conversion_notification_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_conversion_notification_deliveries_conversion_event_id_fkey"
            columns: ["conversion_event_id"]
            isOneToOne: false
            referencedRelation: "opportunity_conversion_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_conversion_notification_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_conversion_notification_deliveries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_conversion_notification_deliveries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_conversion_notification_deliveries_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_correspondence_events: {
        Row: {
          activity_id: string | null
          cc_emails: string[]
          company_id: string
          connection_id: string | null
          created_at: string
          direction: string
          from_email: string | null
          id: string
          is_meaningful: boolean
          linked_contact_id: string | null
          linked_contact_kind: string | null
          noise_reason: string | null
          occurred_at: string
          opportunity_projection_applied: boolean
          opportunity_id: string
          party_role: string
          provider_message_id: string | null
          provider_thread_id: string
          source: string
          subject: string | null
          to_emails: string[]
        }
        Insert: {
          activity_id?: string | null
          cc_emails?: string[]
          company_id: string
          connection_id?: string | null
          created_at?: string
          direction: string
          from_email?: string | null
          id?: string
          is_meaningful: boolean
          linked_contact_id?: string | null
          linked_contact_kind?: string | null
          noise_reason?: string | null
          occurred_at: string
          opportunity_projection_applied?: boolean
          opportunity_id: string
          party_role: string
          provider_message_id?: string | null
          provider_thread_id: string
          source: string
          subject?: string | null
          to_emails?: string[]
        }
        Update: {
          activity_id?: string | null
          cc_emails?: string[]
          company_id?: string
          connection_id?: string | null
          created_at?: string
          direction?: string
          from_email?: string | null
          id?: string
          is_meaningful?: boolean
          linked_contact_id?: string | null
          linked_contact_kind?: string | null
          noise_reason?: string | null
          occurred_at?: string
          opportunity_projection_applied?: boolean
          opportunity_id?: string
          party_role?: string
          provider_message_id?: string | null
          provider_thread_id?: string
          source?: string
          subject?: string | null
          to_emails?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_correspondence_events_activity_company_fkey"
            columns: ["company_id", "activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "opportunity_correspondence_events_company_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_correspondence_events_connection_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_correspondence_events_opportunity_company_fkey"
            columns: ["company_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      opportunity_dispositions: {
        Row: {
          company_id: string
          converted_project_ref: string | null
          created_at: string
          decided_by: string | null
          decided_via: string
          disposition: string
          evidence: Json
          id: string
          merged_into_opportunity_id: string | null
          opportunity_id: string
          reason_code: string | null
          reason_notes: string | null
          superseded_at: string | null
          superseded_by: string | null
        }
        Insert: {
          company_id: string
          converted_project_ref?: string | null
          created_at?: string
          decided_by?: string | null
          decided_via: string
          disposition: string
          evidence?: Json
          id?: string
          merged_into_opportunity_id?: string | null
          opportunity_id: string
          reason_code?: string | null
          reason_notes?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
        }
        Update: {
          company_id?: string
          converted_project_ref?: string | null
          created_at?: string
          decided_by?: string | null
          decided_via?: string
          disposition?: string
          evidence?: Json
          id?: string
          merged_into_opportunity_id?: string | null
          opportunity_id?: string
          reason_code?: string | null
          reason_notes?: string | null
          superseded_at?: string | null
          superseded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_dispositions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_dispositions_company_opp_fk"
            columns: ["company_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "opportunity_dispositions_converted_project_ref_fkey"
            columns: ["converted_project_ref"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_dispositions_converted_project_ref_fkey"
            columns: ["converted_project_ref"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_dispositions_merged_into_opportunity_id_fkey"
            columns: ["merged_into_opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_dispositions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_dispositions_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "opportunity_dispositions"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_email_threads: {
        Row: {
          connection_id: string | null
          created_at: string
          id: string
          opportunity_id: string
          thread_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          id?: string
          opportunity_id: string
          thread_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          id?: string
          opportunity_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_email_threads_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_email_threads_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_follow_up_drafts: {
        Row: {
          ai_draft_history_id: string | null
          company_id: string
          connection_id: string | null
          created_at: string
          created_by: string | null
          current_body: string | null
          discarded_at: string | null
          edited_at: string | null
          edited_by: string | null
          final_sent_body: string | null
          id: string
          opportunity_id: string
          origin: string
          original_body: string
          provider_draft_id: string | null
          provider_thread_id: string | null
          sent_at: string | null
          sequence_number: number | null
          source_event_id: string | null
          status: string
          subject: string
          superseded_at: string | null
          updated_at: string
        }
        Insert: {
          ai_draft_history_id?: string | null
          company_id: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          current_body?: string | null
          discarded_at?: string | null
          edited_at?: string | null
          edited_by?: string | null
          final_sent_body?: string | null
          id?: string
          opportunity_id: string
          origin: string
          original_body: string
          provider_draft_id?: string | null
          provider_thread_id?: string | null
          sent_at?: string | null
          sequence_number?: number | null
          source_event_id?: string | null
          status?: string
          subject?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Update: {
          ai_draft_history_id?: string | null
          company_id?: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          current_body?: string | null
          discarded_at?: string | null
          edited_at?: string | null
          edited_by?: string | null
          final_sent_body?: string | null
          id?: string
          opportunity_id?: string
          origin?: string
          original_body?: string
          provider_draft_id?: string | null
          provider_thread_id?: string | null
          sent_at?: string | null
          sequence_number?: number | null
          source_event_id?: string | null
          status?: string
          subject?: string
          superseded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_follow_up_drafts_ai_draft_history_company_fkey"
            columns: ["company_id", "ai_draft_history_id"]
            isOneToOne: false
            referencedRelation: "ai_draft_history"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "opportunity_follow_up_drafts_company_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_follow_up_drafts_connection_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_follow_up_drafts_created_by_company_fkey"
            columns: ["company_id", "created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "opportunity_follow_up_drafts_edited_by_company_fkey"
            columns: ["company_id", "edited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "opportunity_follow_up_drafts_opportunity_company_fkey"
            columns: ["company_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "opportunity_follow_up_drafts_source_event_company_fkey"
            columns: ["company_id", "source_event_id"]
            isOneToOne: false
            referencedRelation: "opportunity_correspondence_events"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      opportunity_lifecycle_action_audit: {
        Row: {
          action: string
          after_values: Json
          approved_action_key: string | null
          approved_at: string | null
          approved_by: string | null
          before_values: Json
          company_id: string
          created_at: string
          decision_evidence: Json
          decision_reason: string | null
          error_code: string | null
          error_message: string | null
          execution_mode: string
          guard_reason: string | null
          id: string
          opportunity_id: string
          run_id: string | null
          runner: string | null
          status: string
        }
        Insert: {
          action: string
          after_values?: Json
          approved_action_key?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before_values?: Json
          company_id: string
          created_at?: string
          decision_evidence?: Json
          decision_reason?: string | null
          error_code?: string | null
          error_message?: string | null
          execution_mode: string
          guard_reason?: string | null
          id?: string
          opportunity_id: string
          run_id?: string | null
          runner?: string | null
          status: string
        }
        Update: {
          action?: string
          after_values?: Json
          approved_action_key?: string | null
          approved_at?: string | null
          approved_by?: string | null
          before_values?: Json
          company_id?: string
          created_at?: string
          decision_evidence?: Json
          decision_reason?: string | null
          error_code?: string | null
          error_message?: string | null
          execution_mode?: string
          guard_reason?: string | null
          id?: string
          opportunity_id?: string
          run_id?: string | null
          runner?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_lifecycle_action_audit_company_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_lifecycle_action_audit_opportunity_company_fkey"
            columns: ["company_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      opportunity_lifecycle_state: {
        Row: {
          company_id: string
          last_meaningful_at: string | null
          last_meaningful_direction: string | null
          last_meaningful_event_id: string | null
          operator_follow_up_miss_at: string | null
          opportunity_id: string
          protected_until: string | null
          second_follow_up_sent_at: string | null
          stale_status: string | null
          stale_status_at: string | null
          unanswered_follow_up_count: number
          updated_at: string
        }
        Insert: {
          company_id: string
          last_meaningful_at?: string | null
          last_meaningful_direction?: string | null
          last_meaningful_event_id?: string | null
          operator_follow_up_miss_at?: string | null
          opportunity_id: string
          protected_until?: string | null
          second_follow_up_sent_at?: string | null
          stale_status?: string | null
          stale_status_at?: string | null
          unanswered_follow_up_count?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          last_meaningful_at?: string | null
          last_meaningful_direction?: string | null
          last_meaningful_event_id?: string | null
          operator_follow_up_miss_at?: string | null
          opportunity_id?: string
          protected_until?: string | null
          second_follow_up_sent_at?: string | null
          stale_status?: string | null
          stale_status_at?: string | null
          unanswered_follow_up_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_lifecycle_state_company_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_lifecycle_state_last_meaningful_event_company_fkey"
            columns: ["company_id", "last_meaningful_event_id"]
            isOneToOne: false
            referencedRelation: "opportunity_correspondence_events"
            referencedColumns: ["company_id", "id"]
          },
          {
            foreignKeyName: "opportunity_lifecycle_state_opportunity_company_fkey"
            columns: ["company_id", "opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["company_id", "id"]
          },
        ]
      }
      opportunity_merges: {
        Row: {
          company_id: string
          created_at: string
          entity_type: string
          error_code: string | null
          error_message: string | null
          field_fill: Json
          field_overrides: Json
          guard_reason: string | null
          id: string
          loser_id: string
          manifest: Json
          merge_key: string
          resolved_by: string | null
          review_id: string | null
          run_id: string | null
          status: string
          winner_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          entity_type: string
          error_code?: string | null
          error_message?: string | null
          field_fill?: Json
          field_overrides?: Json
          guard_reason?: string | null
          id?: string
          loser_id: string
          manifest?: Json
          merge_key: string
          resolved_by?: string | null
          review_id?: string | null
          run_id?: string | null
          status: string
          winner_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          entity_type?: string
          error_code?: string | null
          error_message?: string | null
          field_fill?: Json
          field_overrides?: Json
          guard_reason?: string | null
          id?: string
          loser_id?: string
          manifest?: Json
          merge_key?: string
          resolved_by?: string | null
          review_id?: string | null
          run_id?: string | null
          status?: string
          winner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_merges_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_merges_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "duplicate_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_views: {
        Row: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        Insert: {
          columns: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          density?: string
          description?: string | null
          filters: Json
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_default?: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key?: string | null
          sort: Json
          sort_position?: number
          updated_at?: string
          zoom_level?: number
        }
        Update: {
          columns?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          density?: string
          description?: string | null
          filters?: Json
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_default?: boolean
          name?: string
          owner_id?: string
          owner_type?: string
          permission_key?: string | null
          sort?: Json
          sort_position?: number
          updated_at?: string
          zoom_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_views_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_contacts: {
        Row: {
          bubble_id: string | null
          created_at: string | null
          display: string | null
          email: string
          id: string
          name: string
          phone: string | null
          role: string
          updated_at: string | null
        }
        Insert: {
          bubble_id?: string | null
          created_at?: string | null
          display?: string | null
          email: string
          id?: string
          name: string
          phone?: string | null
          role: string
          updated_at?: string | null
        }
        Update: {
          bubble_id?: string | null
          created_at?: string | null
          display?: string | null
          email?: string
          id?: string
          name?: string
          phone?: string | null
          role?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      payment_milestones: {
        Row: {
          amount: number
          estimate_id: string
          expected_date: string | null
          id: string
          invoice_id: string | null
          name: string
          paid_at: string | null
          sort_order: number
          type: string
          value: number
        }
        Insert: {
          amount: number
          estimate_id: string
          expected_date?: string | null
          id?: string
          invoice_id?: string | null
          name: string
          paid_at?: string | null
          sort_order?: number
          type: string
          value: number
        }
        Update: {
          amount?: number
          estimate_id?: string
          expected_date?: string | null
          id?: string
          invoice_id?: string | null
          name?: string
          paid_at?: string | null
          sort_order?: number
          type?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_milestones_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_milestones_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          client_id: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
          qb_id: string | null
          reference_number: string | null
          sage_id: string | null
          stripe_payment_intent: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          client_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          qb_id?: string | null
          reference_number?: string | null
          sage_id?: string | null
          stripe_payment_intent?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          client_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          qb_id?: string | null
          reference_number?: string | null
          sage_id?: string | null
          stripe_payment_intent?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_auto_sends: {
        Row: {
          cancelled_at: string | null
          cc_emails: string[] | null
          company_id: string
          connection_id: string
          created_at: string
          draft_history_id: string | null
          draft_text: string
          error: string | null
          id: string
          in_reply_to: string | null
          opportunity_id: string | null
          retry_count: number
          scheduled_send_at: string
          sent_at: string | null
          status: string
          subject: string
          thread_id: string
          to_emails: string[]
        }
        Insert: {
          cancelled_at?: string | null
          cc_emails?: string[] | null
          company_id: string
          connection_id: string
          created_at?: string
          draft_history_id?: string | null
          draft_text: string
          error?: string | null
          id?: string
          in_reply_to?: string | null
          opportunity_id?: string | null
          retry_count?: number
          scheduled_send_at: string
          sent_at?: string | null
          status?: string
          subject: string
          thread_id: string
          to_emails?: string[]
        }
        Update: {
          cancelled_at?: string | null
          cc_emails?: string[] | null
          company_id?: string
          connection_id?: string
          created_at?: string
          draft_history_id?: string | null
          draft_text?: string
          error?: string | null
          id?: string
          in_reply_to?: string | null
          opportunity_id?: string | null
          retry_count?: number
          scheduled_send_at?: string
          sent_at?: string | null
          status?: string
          subject?: string
          thread_id?: string
          to_emails?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "pending_auto_sends_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_auto_sends_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_auto_sends_draft_history_id_fkey"
            columns: ["draft_history_id"]
            isOneToOne: false
            referencedRelation: "ai_draft_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_auto_sends_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stage_configs: {
        Row: {
          auto_follow_up_days: number | null
          auto_follow_up_type: string | null
          color: string
          company_id: string
          created_at: string | null
          default_win_probability: number | null
          deleted_at: string | null
          icon: string | null
          id: string
          is_default: boolean | null
          is_lost_stage: boolean | null
          is_won_stage: boolean | null
          name: string
          slug: string
          sort_order: number
          stale_threshold_days: number | null
        }
        Insert: {
          auto_follow_up_days?: number | null
          auto_follow_up_type?: string | null
          color?: string
          company_id: string
          created_at?: string | null
          default_win_probability?: number | null
          deleted_at?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          is_lost_stage?: boolean | null
          is_won_stage?: boolean | null
          name: string
          slug: string
          sort_order?: number
          stale_threshold_days?: number | null
        }
        Update: {
          auto_follow_up_days?: number | null
          auto_follow_up_type?: string | null
          color?: string
          company_id?: string
          created_at?: string | null
          default_win_probability?: number | null
          deleted_at?: string | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          is_lost_stage?: boolean | null
          is_won_stage?: boolean | null
          name?: string
          slug?: string
          sort_order?: number
          stale_threshold_days?: number | null
        }
        Relationships: []
      }
      pmf_deal_events: {
        Row: {
          created_at: string
          deal_id: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json
        }
        Insert: {
          created_at?: string
          deal_id: string
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json
        }
        Update: {
          created_at?: string
          deal_id?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "pmf_deal_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "pmf_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      pmf_deals: {
        Row: {
          closed_at: string | null
          closed_reason: string | null
          created_at: string
          deal_type: string
          delivered_at: string | null
          deposit_amount_cents: number | null
          deposit_paid_at: string | null
          final_paid_at: string | null
          id: string
          implementation_fee_cents: number | null
          prospect_id: string
          sow_signed_at: string | null
          sow_url: string | null
          stage: string
          stage_entered_at: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          deal_type: string
          delivered_at?: string | null
          deposit_amount_cents?: number | null
          deposit_paid_at?: string | null
          final_paid_at?: string | null
          id?: string
          implementation_fee_cents?: number | null
          prospect_id: string
          sow_signed_at?: string | null
          sow_url?: string | null
          stage: string
          stage_entered_at?: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          deal_type?: string
          delivered_at?: string | null
          deposit_amount_cents?: number | null
          deposit_paid_at?: string | null
          final_paid_at?: string | null
          id?: string
          implementation_fee_cents?: number | null
          prospect_id?: string
          sow_signed_at?: string | null
          sow_url?: string | null
          stage?: string
          stage_entered_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pmf_deals_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "pmf_prospects"
            referencedColumns: ["id"]
          },
        ]
      }
      pmf_notification_log: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          kind: string
          payload: Json
          recipient: string
          sent_at: string | null
          trigger: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          payload: Json
          recipient: string
          sent_at?: string | null
          trigger: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          payload?: Json
          recipient?: string
          sent_at?: string | null
          trigger?: string
        }
        Relationships: []
      }
      pmf_prospects: {
        Row: {
          company: string | null
          created_at: string
          deal_type: string
          email: string | null
          first_contact_at: string
          first_contact_direction: string
          id: string
          name: string
          notes: string | null
          phone: string | null
          referred_by_company_id: string | null
          source: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          deal_type: string
          email?: string | null
          first_contact_at: string
          first_contact_direction: string
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          referred_by_company_id?: string | null
          source: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          deal_type?: string
          email?: string | null
          first_contact_at?: string
          first_contact_direction?: string
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          referred_by_company_id?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pmf_prospects_referred_by_company_id_fkey"
            columns: ["referred_by_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pmf_threshold_snapshots: {
        Row: {
          captured_at: string
          id: string
          state: Json
        }
        Insert: {
          captured_at?: string
          id?: string
          state: Json
        }
        Update: {
          captured_at?: string
          id?: string
          state?: Json
        }
        Relationships: []
      }
      portal_branding: {
        Row: {
          accent_color: string
          company_id: string
          created_at: string
          font_combo: string
          id: string
          logo_url: string | null
          show_descriptions: boolean
          show_discount: boolean
          show_line_totals: boolean
          show_quantities: boolean
          show_tax: boolean
          show_unit_prices: boolean
          template: string
          theme_mode: string
          updated_at: string
          welcome_message: string | null
        }
        Insert: {
          accent_color?: string
          company_id: string
          created_at?: string
          font_combo?: string
          id?: string
          logo_url?: string | null
          show_descriptions?: boolean
          show_discount?: boolean
          show_line_totals?: boolean
          show_quantities?: boolean
          show_tax?: boolean
          show_unit_prices?: boolean
          template?: string
          theme_mode?: string
          updated_at?: string
          welcome_message?: string | null
        }
        Update: {
          accent_color?: string
          company_id?: string
          created_at?: string
          font_combo?: string
          id?: string
          logo_url?: string | null
          show_descriptions?: boolean
          show_discount?: boolean
          show_line_totals?: boolean
          show_quantities?: boolean
          show_tax?: boolean
          show_unit_prices?: boolean
          template?: string
          theme_mode?: string
          updated_at?: string
          welcome_message?: string | null
        }
        Relationships: []
      }
      portal_messages: {
        Row: {
          client_id: string
          company_id: string
          content: string
          created_at: string
          estimate_id: string | null
          id: string
          invoice_id: string | null
          project_id: string | null
          read_at: string | null
          sender_name: string
          sender_type: string
        }
        Insert: {
          client_id: string
          company_id: string
          content: string
          created_at?: string
          estimate_id?: string | null
          id?: string
          invoice_id?: string | null
          project_id?: string | null
          read_at?: string | null
          sender_name: string
          sender_type: string
        }
        Update: {
          client_id?: string
          company_id?: string
          content?: string
          created_at?: string
          estimate_id?: string | null
          id?: string
          invoice_id?: string | null
          project_id?: string | null
          read_at?: string | null
          sender_name?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_messages_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_messages_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_sessions: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          is_preview: boolean
          portal_token_id: string
          session_token: string
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          is_preview?: boolean
          portal_token_id: string
          session_token?: string
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          is_preview?: boolean
          portal_token_id?: string
          session_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_sessions_portal_token_id_fkey"
            columns: ["portal_token_id"]
            isOneToOne: false
            referencedRelation: "portal_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_tokens: {
        Row: {
          client_id: string
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          is_preview: boolean
          revoked_at: string | null
          token: string
          verified_at: string | null
        }
        Insert: {
          client_id: string
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          is_preview?: boolean
          revoked_at?: string | null
          token?: string
          verified_at?: string | null
        }
        Update: {
          client_id?: string
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          is_preview?: boolean
          revoked_at?: string | null
          token?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      product_bundle_items: {
        Row: {
          bundle_product_id: string
          child_product_id: string
          company_id: string
          compatibility_selector: Json | null
          created_at: string
          deleted_at: string | null
          display_order: number
          id: string
          quantity: number
          relationship_kind: string
          suggestion_reason: string | null
          updated_at: string
        }
        Insert: {
          bundle_product_id: string
          child_product_id: string
          company_id: string
          compatibility_selector?: Json | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          quantity?: number
          relationship_kind?: string
          suggestion_reason?: string | null
          updated_at?: string
        }
        Update: {
          bundle_product_id?: string
          child_product_id?: string
          company_id?: string
          compatibility_selector?: Json | null
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          id?: string
          quantity?: number
          relationship_kind?: string
          suggestion_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_bundle_items_bundle_product_id_fkey"
            columns: ["bundle_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundle_items_child_product_id_fkey"
            columns: ["child_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_bundle_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      product_materials: {
        Row: {
          catalog_item_id: string | null
          catalog_variant_id: string | null
          deleted_at: string | null
          id: string
          inventory_item_id: string | null
          notes: string | null
          product_id: string
          quantity_per_unit: number
          scaled_by_option_id: string | null
          unit_id: string | null
          updated_at: string
          variant_selector: Json | null
        }
        Insert: {
          catalog_item_id?: string | null
          catalog_variant_id?: string | null
          deleted_at?: string | null
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          product_id: string
          quantity_per_unit: number
          scaled_by_option_id?: string | null
          unit_id?: string | null
          updated_at?: string
          variant_selector?: Json | null
        }
        Update: {
          catalog_item_id?: string | null
          catalog_variant_id?: string | null
          deleted_at?: string | null
          id?: string
          inventory_item_id?: string | null
          notes?: string | null
          product_id?: string
          quantity_per_unit?: number
          scaled_by_option_id?: string | null
          unit_id?: string | null
          updated_at?: string
          variant_selector?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "product_materials_catalog_item_id_fkey"
            columns: ["catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "product_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_scaled_by_option_id_fkey"
            columns: ["scaled_by_option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      product_option_values: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          option_id: string
          sort_order: number
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          option_id: string
          sort_order?: number
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          option_id?: string
          sort_order?: number
          updated_at?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_option_values_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
        ]
      }
      product_options: {
        Row: {
          affects_price: boolean
          affects_recipe: boolean
          created_at: string
          default_value: string | null
          deleted_at: string | null
          id: string
          kind: string
          name: string
          option_default_source: string | null
          product_id: string
          required: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          affects_price?: boolean
          affects_recipe?: boolean
          created_at?: string
          default_value?: string | null
          deleted_at?: string | null
          id?: string
          kind: string
          name: string
          option_default_source?: string | null
          product_id: string
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          affects_price?: boolean
          affects_recipe?: boolean
          created_at?: string
          default_value?: string | null
          deleted_at?: string | null
          id?: string
          kind?: string
          name?: string
          option_default_source?: string | null
          product_id?: string
          required?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_options_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_pricing_modifiers: {
        Row: {
          amount: number
          created_at: string
          deleted_at: string | null
          id: string
          modifier_kind: string
          option_id: string
          product_id: string
          trigger_int_max: number | null
          trigger_int_min: number | null
          trigger_value_id: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          modifier_kind: string
          option_id: string
          product_id: string
          trigger_int_max?: number | null
          trigger_int_min?: number | null
          trigger_value_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          modifier_kind?: string
          option_id?: string
          product_id?: string
          trigger_int_max?: number | null
          trigger_int_min?: number | null
          trigger_value_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_pricing_modifiers_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "product_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_modifiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_pricing_modifiers_trigger_value_id_fkey"
            columns: ["trigger_value_id"]
            isOneToOne: false
            referencedRelation: "product_option_values"
            referencedColumns: ["id"]
          },
        ]
      }
      product_tax_rates: {
        Row: {
          product_id: string
          tax_rate_id: string
        }
        Insert: {
          product_id: string
          tax_rate_id: string
        }
        Update: {
          product_id?: string
          tax_rate_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_tax_rates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_tax_rates_tax_rate_id_fkey"
            columns: ["tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_price: number
          bundle_pricing_mode: string | null
          category: string | null
          category_id: string | null
          company_id: string
          created_at: string | null
          default_price: number
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_favorite: boolean
          is_taxable: boolean | null
          kind: string
          linked_catalog_item_id: string | null
          minimum_charge: number | null
          minimum_quantity: number | null
          name: string
          pricing_unit: string
          show_bom_on_estimate: boolean
          show_in_storefront: boolean
          sku: string | null
          task_type_id: string | null
          task_type_ref: string | null
          thumbnail_url: string | null
          tiered_pricing: Json
          type: string
          unit: string | null
          unit_cost: number | null
          unit_id: string | null
          updated_at: string | null
        }
        Insert: {
          base_price?: number
          bundle_pricing_mode?: string | null
          category?: string | null
          category_id?: string | null
          company_id: string
          created_at?: string | null
          default_price?: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_favorite?: boolean
          is_taxable?: boolean | null
          kind?: string
          linked_catalog_item_id?: string | null
          minimum_charge?: number | null
          minimum_quantity?: number | null
          name: string
          pricing_unit?: string
          show_bom_on_estimate?: boolean
          show_in_storefront?: boolean
          sku?: string | null
          task_type_id?: string | null
          task_type_ref?: string | null
          thumbnail_url?: string | null
          tiered_pricing?: Json
          type?: string
          unit?: string | null
          unit_cost?: number | null
          unit_id?: string | null
          updated_at?: string | null
        }
        Update: {
          base_price?: number
          bundle_pricing_mode?: string | null
          category?: string | null
          category_id?: string | null
          company_id?: string
          created_at?: string | null
          default_price?: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_favorite?: boolean
          is_taxable?: boolean | null
          kind?: string
          linked_catalog_item_id?: string | null
          minimum_charge?: number | null
          minimum_quantity?: number | null
          name?: string
          pricing_unit?: string
          show_bom_on_estimate?: boolean
          show_in_storefront?: boolean
          sku?: string | null
          task_type_id?: string | null
          task_type_ref?: string | null
          thumbnail_url?: string | null
          tiered_pricing?: Json
          type?: string
          unit?: string | null
          unit_cost?: number | null
          unit_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "catalog_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_linked_catalog_item_id_fkey"
            columns: ["linked_catalog_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_task_type_ref_fkey"
            columns: ["task_type_ref"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
      }
      project_material_demands: {
        Row: {
          available_quantity_at_booking: number | null
          catalog_variant_id: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          demand_key: string
          estimate_id: string | null
          id: string
          line_item_id: string | null
          product_id: string | null
          product_material_id: string | null
          project_id: string
          projected_overrun_quantity: number
          required_quantity: number
          resolver_payload: Json
          source: string
          status: string
          task_id: string | null
          unit_id: string | null
          updated_at: string
          warning_payload: Json
        }
        Insert: {
          available_quantity_at_booking?: number | null
          catalog_variant_id?: string | null
          company_id: string
          created_at?: string
          deleted_at?: string | null
          demand_key: string
          estimate_id?: string | null
          id?: string
          line_item_id?: string | null
          product_id?: string | null
          product_material_id?: string | null
          project_id: string
          projected_overrun_quantity?: number
          required_quantity: number
          resolver_payload?: Json
          source?: string
          status?: string
          task_id?: string | null
          unit_id?: string | null
          updated_at?: string
          warning_payload?: Json
        }
        Update: {
          available_quantity_at_booking?: number | null
          catalog_variant_id?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          demand_key?: string
          estimate_id?: string | null
          id?: string
          line_item_id?: string | null
          product_id?: string | null
          product_material_id?: string | null
          project_id?: string
          projected_overrun_quantity?: number
          required_quantity?: number
          resolver_payload?: Json
          source?: string
          status?: string
          task_id?: string | null
          unit_id?: string | null
          updated_at?: string
          warning_payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_material_demands_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "project_material_demands_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_line_item_id_fkey"
            columns: ["line_item_id"]
            isOneToOne: false
            referencedRelation: "line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_product_material_id_fkey"
            columns: ["product_material_id"]
            isOneToOne: false
            referencedRelation: "product_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_demands_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      project_material_snapshot_items: {
        Row: {
          allocation_id: string | null
          catalog_stock_unit_id: string | null
          catalog_variant_id: string | null
          company_id: string
          created_at: string
          demand_id: string | null
          id: string
          inventory_deduction_id: string | null
          projected_overrun_quantity: number
          quantity: number
          snapshot_id: string
          source_event_id: string | null
          stock_unit_snapshot: Json
          task_material_id: string | null
          unit_id: string | null
        }
        Insert: {
          allocation_id?: string | null
          catalog_stock_unit_id?: string | null
          catalog_variant_id?: string | null
          company_id: string
          created_at?: string
          demand_id?: string | null
          id?: string
          inventory_deduction_id?: string | null
          projected_overrun_quantity?: number
          quantity?: number
          snapshot_id: string
          source_event_id?: string | null
          stock_unit_snapshot?: Json
          task_material_id?: string | null
          unit_id?: string | null
        }
        Update: {
          allocation_id?: string | null
          catalog_stock_unit_id?: string | null
          catalog_variant_id?: string | null
          company_id?: string
          created_at?: string
          demand_id?: string | null
          id?: string
          inventory_deduction_id?: string | null
          projected_overrun_quantity?: number
          quantity?: number
          snapshot_id?: string
          source_event_id?: string | null
          stock_unit_snapshot?: Json
          task_material_id?: string | null
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_material_snapshot_items_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "task_material_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_catalog_stock_unit_id_fkey"
            columns: ["catalog_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "project_material_demands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_inventory_deduction_id_fkey"
            columns: ["inventory_deduction_id"]
            isOneToOne: false
            referencedRelation: "inventory_deductions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "project_material_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_source_event_id_fkey"
            columns: ["source_event_id"]
            isOneToOne: false
            referencedRelation: "catalog_stock_unit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_task_material_id_fkey"
            columns: ["task_material_id"]
            isOneToOne: false
            referencedRelation: "task_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshot_items_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      project_material_snapshots: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          estimate_id: string | null
          id: string
          notes: string | null
          payload: Json
          project_id: string
          snapshot_kind: string
          task_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          estimate_id?: string | null
          id?: string
          notes?: string | null
          payload?: Json
          project_id: string
          snapshot_kind: string
          task_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          estimate_id?: string | null
          id?: string
          notes?: string | null
          payload?: Json
          project_id?: string
          snapshot_kind?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_material_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshots_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_material_snapshots_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      project_notes: {
        Row: {
          attachments: Json
          author_id: string
          company_id: string
          content: string
          content_metadata: Json | null
          created_at: string
          deleted_at: string | null
          event_kind: string | null
          id: string
          mentioned_user_ids: string[]
          photo_url: string | null
          project_id: string
          updated_at: string | null
        }
        Insert: {
          attachments?: Json
          author_id: string
          company_id: string
          content?: string
          content_metadata?: Json | null
          created_at?: string
          deleted_at?: string | null
          event_kind?: string | null
          id?: string
          mentioned_user_ids?: string[]
          photo_url?: string | null
          project_id: string
          updated_at?: string | null
        }
        Update: {
          attachments?: Json
          author_id?: string
          company_id?: string
          content?: string
          content_metadata?: Json | null
          created_at?: string
          deleted_at?: string | null
          event_kind?: string | null
          id?: string
          mentioned_user_ids?: string[]
          photo_url?: string | null
          project_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      project_photo_annotations: {
        Row: {
          annotation_url: string | null
          author_id: string
          company_id: string
          created_at: string
          deleted_at: string | null
          dimensions: Json | null
          id: string
          note: string | null
          photo_url: string
          project_id: string
          rendered_photo_url: string | null
          updated_at: string | null
        }
        Insert: {
          annotation_url?: string | null
          author_id: string
          company_id: string
          created_at?: string
          deleted_at?: string | null
          dimensions?: Json | null
          id?: string
          note?: string | null
          photo_url: string
          project_id: string
          rendered_photo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          annotation_url?: string | null
          author_id?: string
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          dimensions?: Json | null
          id?: string
          note?: string | null
          photo_url?: string
          project_id?: string
          rendered_photo_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      project_photos: {
        Row: {
          caption: string | null
          company_id: string
          created_at: string | null
          deleted_at: string | null
          id: string
          is_client_visible: boolean
          project_id: string
          rendered_url: string | null
          site_visit_id: string | null
          source: Database["public"]["Enums"]["photo_source"]
          taken_at: string | null
          thumbnail_url: string | null
          uploaded_by: string
          url: string
        }
        Insert: {
          caption?: string | null
          company_id: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_client_visible?: boolean
          project_id: string
          rendered_url?: string | null
          site_visit_id?: string | null
          source?: Database["public"]["Enums"]["photo_source"]
          taken_at?: string | null
          thumbnail_url?: string | null
          uploaded_by: string
          url: string
        }
        Update: {
          caption?: string | null
          company_id?: string
          created_at?: string | null
          deleted_at?: string | null
          id?: string
          is_client_visible?: boolean
          project_id?: string
          rendered_url?: string | null
          site_visit_id?: string | null
          source?: Database["public"]["Enums"]["photo_source"]
          taken_at?: string | null
          thumbnail_url?: string | null
          uploaded_by?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_photos_site_visit_id_fkey"
            columns: ["site_visit_id"]
            isOneToOne: false
            referencedRelation: "site_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      project_status_lifecycle_outbox: {
        Row: {
          actor_user_id: string | null
          attempts: number
          available_at: string
          company_id: string
          completed_at: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          new_status: string
          old_status: string
          project_id: string
          project_status_version: number
          project_updated_at: string
          requested_at: string
          status: string
          worker_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          attempts?: number
          available_at?: string
          company_id: string
          completed_at?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          new_status: string
          old_status: string
          project_id: string
          project_status_version: number
          project_updated_at: string
          requested_at?: string
          status?: string
          worker_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          attempts?: number
          available_at?: string
          company_id?: string
          completed_at?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          new_status?: string
          old_status?: string
          project_id?: string
          project_status_version?: number
          project_updated_at?: string
          requested_at?: string
          status?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_status_lifecycle_outbox_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_status_lifecycle_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_status_lifecycle_outbox_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          all_day: boolean
          bubble_id: string | null
          company_id: string
          created_at: string | null
          custom_title: string | null
          deleted_at: string | null
          dependency_overrides: Json | null
          display_order: number | null
          duration: number | null
          end_date: string | null
          end_time: string | null
          id: string
          inventory_deducted: boolean
          paired_from_task_id: string | null
          priority_rank: number | null
          project_id: string
          recurrence_id: string | null
          recurrence_origin_date: string | null
          schedule_confirmed_at: string | null
          schedule_confirmed_by: string | null
          schedule_locked: boolean
          schedule_version: number
          source_estimate_id: string | null
          source_line_item_id: string | null
          start_date: string | null
          start_time: string | null
          status: string
          task_color: string | null
          task_notes: string | null
          task_type_id: string | null
          team_member_ids: string[] | null
          updated_at: string | null
        }
        Insert: {
          all_day?: boolean
          bubble_id?: string | null
          company_id: string
          created_at?: string | null
          custom_title?: string | null
          deleted_at?: string | null
          dependency_overrides?: Json | null
          display_order?: number | null
          duration?: number | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          inventory_deducted?: boolean
          paired_from_task_id?: string | null
          priority_rank?: number | null
          project_id: string
          recurrence_id?: string | null
          recurrence_origin_date?: string | null
          schedule_confirmed_at?: string | null
          schedule_confirmed_by?: string | null
          schedule_locked?: boolean
          schedule_version?: number
          source_estimate_id?: string | null
          source_line_item_id?: string | null
          start_date?: string | null
          start_time?: string | null
          status?: string
          task_color?: string | null
          task_notes?: string | null
          task_type_id?: string | null
          team_member_ids?: string[] | null
          updated_at?: string | null
        }
        Update: {
          all_day?: boolean
          bubble_id?: string | null
          company_id?: string
          created_at?: string | null
          custom_title?: string | null
          deleted_at?: string | null
          dependency_overrides?: Json | null
          display_order?: number | null
          duration?: number | null
          end_date?: string | null
          end_time?: string | null
          id?: string
          inventory_deducted?: boolean
          paired_from_task_id?: string | null
          priority_rank?: number | null
          project_id?: string
          recurrence_id?: string | null
          recurrence_origin_date?: string | null
          schedule_confirmed_at?: string | null
          schedule_confirmed_by?: string | null
          schedule_locked?: boolean
          schedule_version?: number
          source_estimate_id?: string | null
          source_line_item_id?: string | null
          start_date?: string | null
          start_time?: string | null
          status?: string
          task_color?: string | null
          task_notes?: string | null
          task_type_id?: string | null
          team_member_ids?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_paired_from_task_id_fkey"
            columns: ["paired_from_task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "task_recurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
      }
      project_team_members: {
        Row: {
          project_id: string
          user_id: string
        }
        Insert: {
          project_id: string
          user_id: string
        }
        Update: {
          project_id?: string
          user_id?: string
        }
        Relationships: []
      }
      project_views: {
        Row: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        Insert: {
          columns: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          density?: string
          description?: string | null
          filters: Json
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_default?: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key?: string | null
          sort: Json
          sort_position?: number
          updated_at?: string
          zoom_level?: number
        }
        Update: {
          columns?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          density?: string
          description?: string | null
          filters?: Json
          icon?: string | null
          id?: string
          is_archived?: boolean
          is_default?: boolean
          name?: string
          owner_id?: string
          owner_type?: string
          permission_key?: string | null
          sort?: Json
          sort_position?: number
          updated_at?: string
          zoom_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_views_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_views_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          all_day: boolean | null
          bubble_id: string | null
          client_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          description: string | null
          duration: number | null
          end_date: string | null
          estimated_value: number | null
          id: string
          latitude: number | null
          longitude: number | null
          notes: string | null
          opportunity_id: string | null
          opportunity_ref: string | null
          platform_metadata: Json | null
          priority_rank: number | null
          project_images: string[] | null
          source: string | null
          start_date: string | null
          status: string
          status_version: number
          team_member_ids: string[] | null
          title: string
          title_is_auto: boolean
          trade: string | null
          updated_at: string | null
          vinyl_order_status: string | null
          vinyl_ordered_at: string | null
          vinyl_ordered_by: string | null
          visibility: string | null
        }
        Insert: {
          address?: string | null
          all_day?: boolean | null
          bubble_id?: string | null
          client_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          duration?: number | null
          end_date?: string | null
          estimated_value?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          opportunity_id?: string | null
          opportunity_ref?: string | null
          platform_metadata?: Json | null
          priority_rank?: number | null
          project_images?: string[] | null
          source?: string | null
          start_date?: string | null
          status?: string
          status_version?: number
          team_member_ids?: string[] | null
          title: string
          title_is_auto?: boolean
          trade?: string | null
          updated_at?: string | null
          vinyl_order_status?: string | null
          vinyl_ordered_at?: string | null
          vinyl_ordered_by?: string | null
          visibility?: string | null
        }
        Update: {
          address?: string | null
          all_day?: boolean | null
          bubble_id?: string | null
          client_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          duration?: number | null
          end_date?: string | null
          estimated_value?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          notes?: string | null
          opportunity_id?: string | null
          opportunity_ref?: string | null
          platform_metadata?: Json | null
          priority_rank?: number | null
          project_images?: string[] | null
          source?: string | null
          start_date?: string | null
          status?: string
          status_version?: number
          team_member_ids?: string[] | null
          title?: string
          title_is_auto?: boolean
          trade?: string | null
          updated_at?: string | null
          vinyl_order_status?: string | null
          vinyl_ordered_at?: string | null
          vinyl_ordered_by?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_opportunity_ref_fkey"
            columns: ["opportunity_ref"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string | null
          current_uses: number | null
          discount_type: string
          discount_value: number | null
          id: string
          is_active: boolean | null
          max_uses: number | null
          plan_restriction: string | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          current_uses?: number | null
          discount_type: string
          discount_value?: number | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          plan_restriction?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          current_uses?: number | null
          discount_type?: string
          discount_value?: number | null
          id?: string
          is_active?: boolean | null
          max_uses?: number | null
          plan_restriction?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      qa_bugs: {
        Row: {
          account_used: string | null
          actual_behavior: string
          bible_section: string | null
          category: string | null
          claimed_at: string | null
          closed_at: string | null
          console_errors: Json | null
          created_at: string
          dom_snapshot: string | null
          expected_behavior: string
          false_positive: boolean | null
          fix_branch: string | null
          fix_commit: string | null
          fix_notes: string | null
          fix_pr_url: string | null
          fixed_at: string | null
          found_at: string
          frequency: string | null
          human_review_reason: string | null
          id: string
          likely_regression_commit: string | null
          network_errors: Json | null
          page_or_screen: string | null
          platform: string | null
          related_feature: string | null
          related_table: string | null
          reporter_agent: string
          reporter_role: string | null
          requires_human_review: boolean | null
          screenshot_url: string | null
          severity: string
          slug: string | null
          status: string
          steps: Json
          suspected_component: string | null
          suspected_file: string | null
          title: string
          updated_at: string
          url: string | null
          user_impact: string | null
          verification_notes: string | null
          verified: boolean | null
          verified_at: string | null
        }
        Insert: {
          account_used?: string | null
          actual_behavior: string
          bible_section?: string | null
          category?: string | null
          claimed_at?: string | null
          closed_at?: string | null
          console_errors?: Json | null
          created_at?: string
          dom_snapshot?: string | null
          expected_behavior: string
          false_positive?: boolean | null
          fix_branch?: string | null
          fix_commit?: string | null
          fix_notes?: string | null
          fix_pr_url?: string | null
          fixed_at?: string | null
          found_at?: string
          frequency?: string | null
          human_review_reason?: string | null
          id?: string
          likely_regression_commit?: string | null
          network_errors?: Json | null
          page_or_screen?: string | null
          platform?: string | null
          related_feature?: string | null
          related_table?: string | null
          reporter_agent: string
          reporter_role?: string | null
          requires_human_review?: boolean | null
          screenshot_url?: string | null
          severity?: string
          slug?: string | null
          status?: string
          steps?: Json
          suspected_component?: string | null
          suspected_file?: string | null
          title: string
          updated_at?: string
          url?: string | null
          user_impact?: string | null
          verification_notes?: string | null
          verified?: boolean | null
          verified_at?: string | null
        }
        Update: {
          account_used?: string | null
          actual_behavior?: string
          bible_section?: string | null
          category?: string | null
          claimed_at?: string | null
          closed_at?: string | null
          console_errors?: Json | null
          created_at?: string
          dom_snapshot?: string | null
          expected_behavior?: string
          false_positive?: boolean | null
          fix_branch?: string | null
          fix_commit?: string | null
          fix_notes?: string | null
          fix_pr_url?: string | null
          fixed_at?: string | null
          found_at?: string
          frequency?: string | null
          human_review_reason?: string | null
          id?: string
          likely_regression_commit?: string | null
          network_errors?: Json | null
          page_or_screen?: string | null
          platform?: string | null
          related_feature?: string | null
          related_table?: string | null
          reporter_agent?: string
          reporter_role?: string | null
          requires_human_review?: boolean | null
          screenshot_url?: string | null
          severity?: string
          slug?: string | null
          status?: string
          steps?: Json
          suspected_component?: string | null
          suspected_file?: string | null
          title?: string
          updated_at?: string
          url?: string | null
          user_impact?: string | null
          verification_notes?: string | null
          verified?: boolean | null
          verified_at?: string | null
        }
        Relationships: []
      }
      qbo_customer_matches: {
        Row: {
          candidates: Json
          company_id: string
          confidence: string | null
          customer_qb_id: string
          decided_action: string | null
          decided_client_id: string | null
          id: string
          match_basis: string | null
          matched_client_id: string | null
          proposed_action: string
          run_id: string
        }
        Insert: {
          candidates?: Json
          company_id: string
          confidence?: string | null
          customer_qb_id: string
          decided_action?: string | null
          decided_client_id?: string | null
          id?: string
          match_basis?: string | null
          matched_client_id?: string | null
          proposed_action: string
          run_id: string
        }
        Update: {
          candidates?: Json
          company_id?: string
          confidence?: string | null
          customer_qb_id?: string
          decided_action?: string | null
          decided_client_id?: string | null
          id?: string
          match_basis?: string | null
          matched_client_id?: string | null
          proposed_action?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_customer_matches_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qbo_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_import_runs: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          error: string | null
          finished_at: string | null
          history_cutoff: string | null
          id: string
          provider: string
          provider_environment: string
          qb_write_calls: number
          status: string
          totals: Json
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          history_cutoff?: string | null
          id?: string
          provider?: string
          provider_environment?: string
          qb_write_calls?: number
          status?: string
          totals?: Json
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          history_cutoff?: string | null
          id?: string
          provider?: string
          provider_environment?: string
          qb_write_calls?: number
          status?: string
          totals?: Json
        }
        Relationships: []
      }
      qbo_staging_customers: {
        Row: {
          active: boolean | null
          address: string | null
          company_id: string
          company_name: string | null
          contact_name: string | null
          contact_title: string | null
          created_at: string | null
          display_name: string | null
          email: string | null
          id: string
          is_job: boolean | null
          parent_qb_id: string | null
          phone: string | null
          qb_id: string
          raw: Json | null
          run_id: string
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          company_id: string
          company_name?: string | null
          contact_name?: string | null
          contact_title?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_job?: boolean | null
          parent_qb_id?: string | null
          phone?: string | null
          qb_id: string
          raw?: Json | null
          run_id: string
        }
        Update: {
          active?: boolean | null
          address?: string | null
          company_id?: string
          company_name?: string | null
          contact_name?: string | null
          contact_title?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string | null
          id?: string
          is_job?: boolean | null
          parent_qb_id?: string | null
          phone?: string | null
          qb_id?: string
          raw?: Json | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_staging_customers_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qbo_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_staging_estimates: {
        Row: {
          company_id: string
          customer_qb_id: string | null
          doc_number: string | null
          expiration_date: string | null
          id: string
          qb_id: string
          raw: Json | null
          run_id: string
          subtotal: number | null
          tax_amount: number | null
          tax_rate: number | null
          total: number | null
          txn_date: string | null
          txn_status: string | null
        }
        Insert: {
          company_id: string
          customer_qb_id?: string | null
          doc_number?: string | null
          expiration_date?: string | null
          id?: string
          qb_id: string
          raw?: Json | null
          run_id: string
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          total?: number | null
          txn_date?: string | null
          txn_status?: string | null
        }
        Update: {
          company_id?: string
          customer_qb_id?: string | null
          doc_number?: string | null
          expiration_date?: string | null
          id?: string
          qb_id?: string
          raw?: Json | null
          run_id?: string
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          total?: number | null
          txn_date?: string | null
          txn_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_staging_estimates_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qbo_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_staging_invoices: {
        Row: {
          balance: number | null
          company_id: string
          customer_qb_id: string | null
          derived_status: string | null
          doc_number: string | null
          due_date: string | null
          estimate_qb_id: string | null
          id: string
          qb_id: string
          raw: Json | null
          run_id: string
          subtotal: number | null
          tax_amount: number | null
          tax_rate: number | null
          total: number | null
          txn_date: string | null
        }
        Insert: {
          balance?: number | null
          company_id: string
          customer_qb_id?: string | null
          derived_status?: string | null
          doc_number?: string | null
          due_date?: string | null
          estimate_qb_id?: string | null
          id?: string
          qb_id: string
          raw?: Json | null
          run_id: string
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          total?: number | null
          txn_date?: string | null
        }
        Update: {
          balance?: number | null
          company_id?: string
          customer_qb_id?: string | null
          derived_status?: string | null
          doc_number?: string | null
          due_date?: string | null
          estimate_qb_id?: string | null
          id?: string
          qb_id?: string
          raw?: Json | null
          run_id?: string
          subtotal?: number | null
          tax_amount?: number | null
          tax_rate?: number | null
          total?: number | null
          txn_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_staging_invoices_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qbo_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_staging_line_items: {
        Row: {
          amount: number | null
          company_id: string
          description: string | null
          id: string
          is_taxable: boolean | null
          name: string | null
          parent_qb_id: string
          parent_type: string
          qb_item_type: string | null
          qb_line_id: string | null
          quantity: number | null
          run_id: string
          sort_order: number | null
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          company_id: string
          description?: string | null
          id?: string
          is_taxable?: boolean | null
          name?: string | null
          parent_qb_id: string
          parent_type: string
          qb_item_type?: string | null
          qb_line_id?: string | null
          quantity?: number | null
          run_id: string
          sort_order?: number | null
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          company_id?: string
          description?: string | null
          id?: string
          is_taxable?: boolean | null
          name?: string | null
          parent_qb_id?: string
          parent_type?: string
          qb_item_type?: string | null
          qb_line_id?: string | null
          quantity?: number | null
          run_id?: string
          sort_order?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_staging_line_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qbo_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_staging_payments: {
        Row: {
          applied_lines: Json
          company_id: string
          customer_qb_id: string | null
          id: string
          qb_id: string
          raw: Json | null
          run_id: string
          total_amt: number | null
          txn_date: string | null
          unapplied_amt: number | null
        }
        Insert: {
          applied_lines?: Json
          company_id: string
          customer_qb_id?: string | null
          id?: string
          qb_id: string
          raw?: Json | null
          run_id: string
          total_amt?: number | null
          txn_date?: string | null
          unapplied_amt?: number | null
        }
        Update: {
          applied_lines?: Json
          company_id?: string
          customer_qb_id?: string | null
          id?: string
          qb_id?: string
          raw?: Json | null
          run_id?: string
          total_amt?: number | null
          txn_date?: string | null
          unapplied_amt?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "qbo_staging_payments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "qbo_import_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      question_pool: {
        Row: {
          created_at: string
          difficulty: number
          dimension: string
          id: string
          is_impression_management: boolean
          options: Json | null
          reverse_scored: boolean
          scoring_weights: Json
          secondary_dimension: string | null
          sub_dimension: string | null
          text: string
          type: string
          validity_pair_id: string | null
          version_availability: string[]
        }
        Insert: {
          created_at?: string
          difficulty?: number
          dimension: string
          id: string
          is_impression_management?: boolean
          options?: Json | null
          reverse_scored?: boolean
          scoring_weights: Json
          secondary_dimension?: string | null
          sub_dimension?: string | null
          text: string
          type: string
          validity_pair_id?: string | null
          version_availability?: string[]
        }
        Update: {
          created_at?: string
          difficulty?: number
          dimension?: string
          id?: string
          is_impression_management?: boolean
          options?: Json | null
          reverse_scored?: boolean
          scoring_weights?: Json
          secondary_dimension?: string | null
          sub_dimension?: string | null
          text?: string
          type?: string
          validity_pair_id?: string | null
          version_availability?: string[]
        }
        Relationships: []
      }
      recurring_expenses: {
        Row: {
          amount: number
          cadence: string
          category_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          end_date: string | null
          id: string
          name: string
          next_due_date: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          cadence: string
          category_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          name: string
          next_due_date: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          cadence?: string
          category_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          end_date?: string | null
          id?: string
          name?: string
          next_due_date?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission: string
          role_id: string
          scope: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission: string
          role_id: string
          scope?: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: string
          role_id?: string
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          company_id: string | null
          created_at: string
          description: string | null
          hierarchy: number
          id: string
          is_preset: boolean
          name: string
          updated_at: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          description?: string | null
          hierarchy?: number
          id?: string
          is_preset?: boolean
          name: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          description?: string | null
          hierarchy?: number
          id?: string
          is_preset?: boolean
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      score_norms: {
        Row: {
          computed_at: string
          dimension: string
          id: string
          percentile_map: Json
          sample_size: number
          segment: string
        }
        Insert: {
          computed_at?: string
          dimension: string
          id?: string
          percentile_map: Json
          sample_size?: number
          segment?: string
        }
        Update: {
          computed_at?: string
          dimension?: string
          id?: string
          percentile_map?: Json
          sample_size?: number
          segment?: string
        }
        Relationships: []
      }
      shop_categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      shop_inventory_reservations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          quantity: number
          stripe_payment_intent_id: string
          variant_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          quantity: number
          stripe_payment_intent_id: string
          variant_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          quantity?: number
          stripe_payment_intent_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_inventory_reservations_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "shop_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_order_items: {
        Row: {
          id: string
          image_url: string | null
          option_values: Json | null
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          sku: string
          unit_price_cents: number
          variant_id: string | null
          variant_label: string
        }
        Insert: {
          id?: string
          image_url?: string | null
          option_values?: Json | null
          order_id: string
          product_id?: string | null
          product_name: string
          quantity: number
          sku: string
          unit_price_cents: number
          variant_id?: string | null
          variant_label: string
        }
        Update: {
          id?: string
          image_url?: string | null
          option_values?: Json | null
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sku?: string
          unit_price_cents?: number
          variant_id?: string | null
          variant_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_order_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "shop_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_orders: {
        Row: {
          created_at: string
          email: string
          id: string
          notes: string | null
          order_number: string
          paid_at: string | null
          shipped_at: string | null
          shipping_address: Json
          shipping_cents: number
          shipping_method_id: string | null
          status: string
          stripe_payment_intent_id: string
          stripe_tax_calculation_id: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          order_number: string
          paid_at?: string | null
          shipped_at?: string | null
          shipping_address: Json
          shipping_cents: number
          shipping_method_id?: string | null
          status?: string
          stripe_payment_intent_id: string
          stripe_tax_calculation_id?: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          order_number?: string
          paid_at?: string | null
          shipped_at?: string | null
          shipping_address?: Json
          shipping_cents?: number
          shipping_method_id?: string | null
          status?: string
          stripe_payment_intent_id?: string
          stripe_tax_calculation_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_orders_shipping_method_id_fkey"
            columns: ["shipping_method_id"]
            isOneToOne: false
            referencedRelation: "shop_shipping_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_product_option_values: {
        Row: {
          id: string
          option_id: string
          sort_order: number
          value: string
        }
        Insert: {
          id?: string
          option_id: string
          sort_order?: number
          value: string
        }
        Update: {
          id?: string
          option_id?: string
          sort_order?: number
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_product_option_values_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "shop_product_options"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_product_options: {
        Row: {
          id: string
          name: string
          product_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          product_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_product_options_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_products: {
        Row: {
          archived_at: string | null
          category_id: string
          created_at: string
          description: string | null
          id: string
          images: Json
          is_active: boolean
          is_featured: boolean
          name: string
          price_cents: number
          slug: string
          sort_order: number
          tax_code: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category_id: string
          created_at?: string
          description?: string | null
          id?: string
          images?: Json
          is_active?: boolean
          is_featured?: boolean
          name: string
          price_cents: number
          slug: string
          sort_order?: number
          tax_code?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category_id?: string
          created_at?: string
          description?: string | null
          id?: string
          images?: Json
          is_active?: boolean
          is_featured?: boolean
          name?: string
          price_cents?: number
          slug?: string
          sort_order?: number
          tax_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "shop_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_settings: {
        Row: {
          id: string
          store_live: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          store_live?: boolean
          updated_at?: string
        }
        Update: {
          id?: string
          store_live?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      shop_shipping_methods: {
        Row: {
          description: string | null
          id: string
          is_active: boolean
          min_order_cents: number | null
          name: string
          price_cents: number
          sort_order: number
        }
        Insert: {
          description?: string | null
          id?: string
          is_active?: boolean
          min_order_cents?: number | null
          name: string
          price_cents: number
          sort_order?: number
        }
        Update: {
          description?: string | null
          id?: string
          is_active?: boolean
          min_order_cents?: number | null
          name?: string
          price_cents?: number
          sort_order?: number
        }
        Relationships: []
      }
      shop_variant_option_values: {
        Row: {
          option_value_id: string
          variant_id: string
        }
        Insert: {
          option_value_id: string
          variant_id: string
        }
        Update: {
          option_value_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_variant_option_values_option_value_id_fkey"
            columns: ["option_value_id"]
            isOneToOne: false
            referencedRelation: "shop_product_option_values"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_variant_option_values_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "shop_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_variants: {
        Row: {
          id: string
          is_active: boolean
          price_cents: number
          product_id: string
          reserved_quantity: number
          sku: string
          sort_order: number
          stock_quantity: number
        }
        Insert: {
          id?: string
          is_active?: boolean
          price_cents: number
          product_id: string
          reserved_quantity?: number
          sku: string
          sort_order?: number
          stock_quantity?: number
        }
        Update: {
          id?: string
          is_active?: boolean
          price_cents?: number
          product_id?: string
          reserved_quantity?: number
          sku?: string
          sort_order?: number
          stock_quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "shop_products"
            referencedColumns: ["id"]
          },
        ]
      }
      site_visits: {
        Row: {
          activity_id: string | null
          assignee_ids: string[] | null
          calendar_event_id: string | null
          client_id: string | null
          client_ref: string | null
          company_id: string
          completed_at: string | null
          created_at: string | null
          created_by: string
          deleted_at: string | null
          duration_minutes: number
          id: string
          internal_notes: string | null
          measurements: string | null
          notes: string | null
          opportunity_id: string | null
          photos: string[] | null
          project_id: string | null
          project_ref: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["site_visit_status"]
          updated_at: string | null
        }
        Insert: {
          activity_id?: string | null
          assignee_ids?: string[] | null
          calendar_event_id?: string | null
          client_id?: string | null
          client_ref?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          created_by: string
          deleted_at?: string | null
          duration_minutes?: number
          id?: string
          internal_notes?: string | null
          measurements?: string | null
          notes?: string | null
          opportunity_id?: string | null
          photos?: string[] | null
          project_id?: string | null
          project_ref?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["site_visit_status"]
          updated_at?: string | null
        }
        Update: {
          activity_id?: string | null
          assignee_ids?: string[] | null
          calendar_event_id?: string | null
          client_id?: string | null
          client_ref?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          deleted_at?: string | null
          duration_minutes?: number
          id?: string
          internal_notes?: string | null
          measurements?: string | null
          notes?: string | null
          opportunity_id?: string | null
          photos?: string[] | null
          project_id?: string | null
          project_ref?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["site_visit_status"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_visits_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_visits_client_ref_fkey"
            columns: ["client_ref"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_visits_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_visits_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_visits_project_ref_fkey"
            columns: ["project_ref"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_acceptance_events: {
        Row: {
          accepted_at: string
          accepted_by_user_id: string
          accepted_ip: string | null
          accepted_user_agent: string | null
          event_type: string
          id: string
          is_test: boolean
          payload_hash: string | null
          scope_document_id: string | null
          signature_evidence_url: string | null
          signature_method: string | null
          spec_project_id: string
        }
        Insert: {
          accepted_at?: string
          accepted_by_user_id: string
          accepted_ip?: string | null
          accepted_user_agent?: string | null
          event_type: string
          id?: string
          is_test?: boolean
          payload_hash?: string | null
          scope_document_id?: string | null
          signature_evidence_url?: string | null
          signature_method?: string | null
          spec_project_id: string
        }
        Update: {
          accepted_at?: string
          accepted_by_user_id?: string
          accepted_ip?: string | null
          accepted_user_agent?: string | null
          event_type?: string
          id?: string
          is_test?: boolean
          payload_hash?: string | null
          scope_document_id?: string | null
          signature_evidence_url?: string | null
          signature_method?: string | null
          spec_project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_acceptance_events_accepted_by_user_id_fkey"
            columns: ["accepted_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_acceptance_events_scope_document_id_fkey"
            columns: ["scope_document_id"]
            isOneToOne: false
            referencedRelation: "spec_scope_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_acceptance_events_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_blocked_buyers: {
        Row: {
          blocked_at: string | null
          blocked_by_user_id: string | null
          blocked_reason: string
          email: string
          id: string
          stripe_customer_id: string | null
          unblocked_at: string | null
        }
        Insert: {
          blocked_at?: string | null
          blocked_by_user_id?: string | null
          blocked_reason: string
          email: string
          id?: string
          stripe_customer_id?: string | null
          unblocked_at?: string | null
        }
        Update: {
          blocked_at?: string | null
          blocked_by_user_id?: string | null
          blocked_reason?: string
          email?: string
          id?: string
          stripe_customer_id?: string | null
          unblocked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_blocked_buyers_blocked_by_user_id_fkey"
            columns: ["blocked_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_capacity: {
        Row: {
          admin_notes: string | null
          build_days_max: number
          build_days_min: number
          discovery_days_max: number
          discovery_days_min: number
          is_accepting_bookings: boolean
          manual_next_start_override: string | null
          polish_hours_budget: number
          public_note: string | null
          retainer_monthly_cents: number
          slot_ceiling: number
          subscription_multiplier_estimate: number
          support_window_days: number
          tier: string
          total_price_cents: number
          updated_at: string | null
        }
        Insert: {
          admin_notes?: string | null
          build_days_max: number
          build_days_min: number
          discovery_days_max: number
          discovery_days_min: number
          is_accepting_bookings?: boolean
          manual_next_start_override?: string | null
          polish_hours_budget: number
          public_note?: string | null
          retainer_monthly_cents: number
          slot_ceiling: number
          subscription_multiplier_estimate: number
          support_window_days: number
          tier: string
          total_price_cents: number
          updated_at?: string | null
        }
        Update: {
          admin_notes?: string | null
          build_days_max?: number
          build_days_min?: number
          discovery_days_max?: number
          discovery_days_min?: number
          is_accepting_bookings?: boolean
          manual_next_start_override?: string | null
          polish_hours_budget?: number
          public_note?: string | null
          retainer_monthly_cents?: number
          slot_ceiling?: number
          subscription_multiplier_estimate?: number
          support_window_days?: number
          tier?: string
          total_price_cents?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      spec_change_orders: {
        Row: {
          acceptance_event_id: string | null
          approved_at: string | null
          change_type: Database["public"]["Enums"]["spec_change_order_type"]
          completed_at: string | null
          declined_at: string | null
          delivery_impact_days: number | null
          description: string
          estimated_hours: number | null
          final_cost_cents: number | null
          fixed_price_cents: number | null
          hourly_rate_cents: number | null
          id: string
          invoiced_at: string | null
          is_test: boolean
          paid_at: string | null
          proposed_at: string | null
          spec_project_id: string
          status: Database["public"]["Enums"]["spec_change_order_status"]
          stripe_invoice_id: string | null
          title: string
        }
        Insert: {
          acceptance_event_id?: string | null
          approved_at?: string | null
          change_type: Database["public"]["Enums"]["spec_change_order_type"]
          completed_at?: string | null
          declined_at?: string | null
          delivery_impact_days?: number | null
          description: string
          estimated_hours?: number | null
          final_cost_cents?: number | null
          fixed_price_cents?: number | null
          hourly_rate_cents?: number | null
          id?: string
          invoiced_at?: string | null
          is_test?: boolean
          paid_at?: string | null
          proposed_at?: string | null
          spec_project_id: string
          status?: Database["public"]["Enums"]["spec_change_order_status"]
          stripe_invoice_id?: string | null
          title: string
        }
        Update: {
          acceptance_event_id?: string | null
          approved_at?: string | null
          change_type?: Database["public"]["Enums"]["spec_change_order_type"]
          completed_at?: string | null
          declined_at?: string | null
          delivery_impact_days?: number | null
          description?: string
          estimated_hours?: number | null
          final_cost_cents?: number | null
          fixed_price_cents?: number | null
          hourly_rate_cents?: number | null
          id?: string
          invoiced_at?: string | null
          is_test?: boolean
          paid_at?: string | null
          proposed_at?: string | null
          spec_project_id?: string
          status?: Database["public"]["Enums"]["spec_change_order_status"]
          stripe_invoice_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_change_orders_acceptance_event_id_fkey"
            columns: ["acceptance_event_id"]
            isOneToOne: false
            referencedRelation: "spec_acceptance_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_change_orders_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_communications: {
        Row: {
          body: string | null
          channel: string
          direction: string
          id: string
          is_test: boolean
          logged_by_user_id: string | null
          occurred_at: string | null
          spec_project_id: string
          summary: string
        }
        Insert: {
          body?: string | null
          channel: string
          direction: string
          id?: string
          is_test?: boolean
          logged_by_user_id?: string | null
          occurred_at?: string | null
          spec_project_id: string
          summary: string
        }
        Update: {
          body?: string | null
          channel?: string
          direction?: string
          id?: string
          is_test?: boolean
          logged_by_user_id?: string | null
          occurred_at?: string | null
          spec_project_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_communications_logged_by_user_id_fkey"
            columns: ["logged_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_communications_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_email_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          is_test: boolean
          last_attempt_at: string | null
          last_error: string | null
          payload: Json
          recipient_email: string
          recipient_user_id: string | null
          sent_at: string | null
          spec_project_id: string | null
          status: string
          template_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          is_test?: boolean
          last_attempt_at?: string | null
          last_error?: string | null
          payload?: Json
          recipient_email: string
          recipient_user_id?: string | null
          sent_at?: string | null
          spec_project_id?: string | null
          status?: string
          template_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          is_test?: boolean
          last_attempt_at?: string | null
          last_error?: string | null
          payload?: Json
          recipient_email?: string
          recipient_user_id?: string | null
          sent_at?: string | null
          spec_project_id?: string | null
          status?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_email_outbox_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_email_outbox_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_feature_acceptance: {
        Row: {
          acceptance_criteria: string
          failure_notes: string | null
          feature_name: string
          id: string
          is_test: boolean
          scope_document_id: string
          spec_project_id: string
          status: Database["public"]["Enums"]["spec_feature_status"]
          verified_at: string | null
          verified_by_user_id: string | null
        }
        Insert: {
          acceptance_criteria: string
          failure_notes?: string | null
          feature_name: string
          id?: string
          is_test?: boolean
          scope_document_id: string
          spec_project_id: string
          status?: Database["public"]["Enums"]["spec_feature_status"]
          verified_at?: string | null
          verified_by_user_id?: string | null
        }
        Update: {
          acceptance_criteria?: string
          failure_notes?: string | null
          feature_name?: string
          id?: string
          is_test?: boolean
          scope_document_id?: string
          spec_project_id?: string
          status?: Database["public"]["Enums"]["spec_feature_status"]
          verified_at?: string | null
          verified_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_feature_acceptance_scope_document_id_fkey"
            columns: ["scope_document_id"]
            isOneToOne: false
            referencedRelation: "spec_scope_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_feature_acceptance_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_feature_acceptance_verified_by_user_id_fkey"
            columns: ["verified_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_internal_notes: {
        Row: {
          body: string
          created_at: string
          created_by_user_id: string
          id: string
          is_test: boolean
          spec_project_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by_user_id: string
          id?: string
          is_test?: boolean
          spec_project_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by_user_id?: string
          id?: string
          is_test?: boolean
          spec_project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_internal_notes_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_internal_notes_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_module_entitlements: {
        Row: {
          company_id: string
          disabled_at: string | null
          disabled_reason: string | null
          enabled: boolean
          enabled_at: string | null
          entitled_at: string | null
          id: string
          is_test: boolean
          module_key: string
          multiplier: number
          spec_project_id: string
          stripe_subscription_item_id: string | null
          surcharge_cents: number | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          disabled_at?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          enabled_at?: string | null
          entitled_at?: string | null
          id?: string
          is_test?: boolean
          module_key: string
          multiplier: number
          spec_project_id: string
          stripe_subscription_item_id?: string | null
          surcharge_cents?: number | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          disabled_at?: string | null
          disabled_reason?: string | null
          enabled?: boolean
          enabled_at?: string | null
          entitled_at?: string | null
          id?: string
          is_test?: boolean
          module_key?: string
          multiplier?: number
          spec_project_id?: string
          stripe_subscription_item_id?: string | null
          surcharge_cents?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_module_entitlements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_module_entitlements_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_owner_approval_requests: {
        Row: {
          account_holder_user_id: string
          approval_token_hash: string | null
          approved_deposit_cents: number
          approved_tos_version_hash: string | null
          approved_total_cents: number
          buyer_checkout_expires_at: string | null
          buyer_checkout_token_hash: string | null
          buyer_user_id: string
          decided_at: string | null
          decided_ip: string | null
          decided_user_agent: string | null
          expires_at: string | null
          id: string
          is_test: boolean
          linked_company_id: string
          requested_at: string | null
          spec_project_id: string
          status: Database["public"]["Enums"]["spec_owner_approval_status"]
          tier: string
        }
        Insert: {
          account_holder_user_id: string
          approval_token_hash?: string | null
          approved_deposit_cents: number
          approved_tos_version_hash?: string | null
          approved_total_cents: number
          buyer_checkout_expires_at?: string | null
          buyer_checkout_token_hash?: string | null
          buyer_user_id: string
          decided_at?: string | null
          decided_ip?: string | null
          decided_user_agent?: string | null
          expires_at?: string | null
          id?: string
          is_test?: boolean
          linked_company_id: string
          requested_at?: string | null
          spec_project_id: string
          status?: Database["public"]["Enums"]["spec_owner_approval_status"]
          tier: string
        }
        Update: {
          account_holder_user_id?: string
          approval_token_hash?: string | null
          approved_deposit_cents?: number
          approved_tos_version_hash?: string | null
          approved_total_cents?: number
          buyer_checkout_expires_at?: string | null
          buyer_checkout_token_hash?: string | null
          buyer_user_id?: string
          decided_at?: string | null
          decided_ip?: string | null
          decided_user_agent?: string | null
          expires_at?: string | null
          id?: string
          is_test?: boolean
          linked_company_id?: string
          requested_at?: string | null
          spec_project_id?: string
          status?: Database["public"]["Enums"]["spec_owner_approval_status"]
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_owner_approval_requests_account_holder_user_id_fkey"
            columns: ["account_holder_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_owner_approval_requests_buyer_user_id_fkey"
            columns: ["buyer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_owner_approval_requests_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_owner_approval_requests_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_payments: {
        Row: {
          amount_cents: number
          amount_refunded_cents: number | null
          created_at: string | null
          credit_note_stripe_id: string | null
          due_date: string | null
          id: string
          invoiced_at: string | null
          is_test: boolean
          marked_uncollectible_at: string | null
          milestone: Database["public"]["Enums"]["spec_payment_milestone"]
          overdue_at: string | null
          paid_at: string | null
          refunded_at: string | null
          spec_project_id: string
          status: Database["public"]["Enums"]["spec_payment_status"]
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          tax_cents: number | null
          total_cents: number
          voided_at: string | null
        }
        Insert: {
          amount_cents: number
          amount_refunded_cents?: number | null
          created_at?: string | null
          credit_note_stripe_id?: string | null
          due_date?: string | null
          id?: string
          invoiced_at?: string | null
          is_test?: boolean
          marked_uncollectible_at?: string | null
          milestone: Database["public"]["Enums"]["spec_payment_milestone"]
          overdue_at?: string | null
          paid_at?: string | null
          refunded_at?: string | null
          spec_project_id: string
          status?: Database["public"]["Enums"]["spec_payment_status"]
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number | null
          total_cents: number
          voided_at?: string | null
        }
        Update: {
          amount_cents?: number
          amount_refunded_cents?: number | null
          created_at?: string | null
          credit_note_stripe_id?: string | null
          due_date?: string | null
          id?: string
          invoiced_at?: string | null
          is_test?: boolean
          marked_uncollectible_at?: string | null
          milestone?: Database["public"]["Enums"]["spec_payment_milestone"]
          overdue_at?: string | null
          paid_at?: string | null
          refunded_at?: string | null
          spec_project_id?: string
          status?: Database["public"]["Enums"]["spec_payment_status"]
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number | null
          total_cents?: number
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_payments_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_projects: {
        Row: {
          account_holder_user_id: string | null
          attribution: Json | null
          billing_address_line1: string | null
          billing_address_line2: string | null
          billing_city: string | null
          billing_country: string | null
          billing_postal_code: string | null
          billing_province: string | null
          build_started_at: string | null
          buyer_user_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          checkout_token_expires_at: string | null
          checkout_token_issued_at: string | null
          company_provisioned_at: string | null
          completed_at: string | null
          created_at: string | null
          customer_email: string
          customer_gst_number: string | null
          customer_name: string | null
          customer_phone: string | null
          deposit_paid_at: string | null
          discovery_scheduled_at: string | null
          discovery_started_at: string | null
          estimated_completion_date: string | null
          forfeit_at: string | null
          hold_type: Database["public"]["Enums"]["spec_hold_type"] | null
          id: string
          intake_completed_at: string | null
          intake_files: Json
          intake_no_discovery_reminder_count: number
          intake_reminder_count: number
          intake_responses: Json | null
          intake_sent_at: string | null
          intake_token_hash: string | null
          intake_token_issued_at: string | null
          is_test: boolean
          last_communication_at: string | null
          last_intake_no_discovery_reminder_at: string | null
          last_intake_reminder_at: string | null
          linked_company_id: string | null
          locked_module_surcharge_cents: number | null
          locked_subscription_multiplier: number | null
          midpoint_accepted_at: string | null
          midpoint_demo_at: string | null
          no_show_count: number | null
          notes: string | null
          on_hold_at: string | null
          on_hold_expires_at: string | null
          on_hold_reason: string | null
          ops_blocked_review_reminder_sent_at: string | null
          original_tier: string | null
          owner_approval_requested_at: string | null
          owner_approved_at: string | null
          owner_declined_at: string | null
          polish_hours_budget: number | null
          polish_hours_used: number | null
          prior_status:
            | Database["public"]["Enums"]["spec_project_status"]
            | null
          quebec_eligibility_attested_at: string | null
          quebec_eligibility_payload: Json | null
          referrer_email: string | null
          refunded_at: string | null
          regulated_workflow_flagged_at: string | null
          regulated_workflow_flags: Json | null
          resume_requested_at: string | null
          resumed_at: string | null
          retainer_started_at: string | null
          scope_doc_drafted_at: string | null
          scope_doc_sent_at: string | null
          scope_doc_signed_at: string | null
          scope_doc_url: string | null
          stalled_at: string | null
          stalled_reason: string | null
          status: Database["public"]["Enums"]["spec_project_status"]
          stripe_customer_id: string | null
          stripe_session_id: string | null
          subscription_first_bill_at: string | null
          subscription_locked_at: string | null
          subscription_renegotiate_at: string | null
          support_window_ends_at: string | null
          tier: string
          tier_upgraded_at: string | null
          tos_accepted_at: string | null
          tos_accepted_ip: string | null
          tos_version_accepted: string | null
          updated_at: string | null
          walkthrough_completed_at: string | null
          walkthrough_recording_url: string | null
        }
        Insert: {
          account_holder_user_id?: string | null
          attribution?: Json | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
          billing_province?: string | null
          build_started_at?: string | null
          buyer_user_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          checkout_token_expires_at?: string | null
          checkout_token_issued_at?: string | null
          company_provisioned_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_email: string
          customer_gst_number?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit_paid_at?: string | null
          discovery_scheduled_at?: string | null
          discovery_started_at?: string | null
          estimated_completion_date?: string | null
          forfeit_at?: string | null
          hold_type?: Database["public"]["Enums"]["spec_hold_type"] | null
          id?: string
          intake_completed_at?: string | null
          intake_files?: Json
          intake_no_discovery_reminder_count?: number
          intake_reminder_count?: number
          intake_responses?: Json | null
          intake_sent_at?: string | null
          intake_token_hash?: string | null
          intake_token_issued_at?: string | null
          is_test?: boolean
          last_communication_at?: string | null
          last_intake_no_discovery_reminder_at?: string | null
          last_intake_reminder_at?: string | null
          linked_company_id?: string | null
          locked_module_surcharge_cents?: number | null
          locked_subscription_multiplier?: number | null
          midpoint_accepted_at?: string | null
          midpoint_demo_at?: string | null
          no_show_count?: number | null
          notes?: string | null
          on_hold_at?: string | null
          on_hold_expires_at?: string | null
          on_hold_reason?: string | null
          ops_blocked_review_reminder_sent_at?: string | null
          original_tier?: string | null
          owner_approval_requested_at?: string | null
          owner_approved_at?: string | null
          owner_declined_at?: string | null
          polish_hours_budget?: number | null
          polish_hours_used?: number | null
          prior_status?:
            | Database["public"]["Enums"]["spec_project_status"]
            | null
          quebec_eligibility_attested_at?: string | null
          quebec_eligibility_payload?: Json | null
          referrer_email?: string | null
          refunded_at?: string | null
          regulated_workflow_flagged_at?: string | null
          regulated_workflow_flags?: Json | null
          resume_requested_at?: string | null
          resumed_at?: string | null
          retainer_started_at?: string | null
          scope_doc_drafted_at?: string | null
          scope_doc_sent_at?: string | null
          scope_doc_signed_at?: string | null
          scope_doc_url?: string | null
          stalled_at?: string | null
          stalled_reason?: string | null
          status: Database["public"]["Enums"]["spec_project_status"]
          stripe_customer_id?: string | null
          stripe_session_id?: string | null
          subscription_first_bill_at?: string | null
          subscription_locked_at?: string | null
          subscription_renegotiate_at?: string | null
          support_window_ends_at?: string | null
          tier: string
          tier_upgraded_at?: string | null
          tos_accepted_at?: string | null
          tos_accepted_ip?: string | null
          tos_version_accepted?: string | null
          updated_at?: string | null
          walkthrough_completed_at?: string | null
          walkthrough_recording_url?: string | null
        }
        Update: {
          account_holder_user_id?: string | null
          attribution?: Json | null
          billing_address_line1?: string | null
          billing_address_line2?: string | null
          billing_city?: string | null
          billing_country?: string | null
          billing_postal_code?: string | null
          billing_province?: string | null
          build_started_at?: string | null
          buyer_user_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          checkout_token_expires_at?: string | null
          checkout_token_issued_at?: string | null
          company_provisioned_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_email?: string
          customer_gst_number?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          deposit_paid_at?: string | null
          discovery_scheduled_at?: string | null
          discovery_started_at?: string | null
          estimated_completion_date?: string | null
          forfeit_at?: string | null
          hold_type?: Database["public"]["Enums"]["spec_hold_type"] | null
          id?: string
          intake_completed_at?: string | null
          intake_files?: Json
          intake_no_discovery_reminder_count?: number
          intake_reminder_count?: number
          intake_responses?: Json | null
          intake_sent_at?: string | null
          intake_token_hash?: string | null
          intake_token_issued_at?: string | null
          is_test?: boolean
          last_communication_at?: string | null
          last_intake_no_discovery_reminder_at?: string | null
          last_intake_reminder_at?: string | null
          linked_company_id?: string | null
          locked_module_surcharge_cents?: number | null
          locked_subscription_multiplier?: number | null
          midpoint_accepted_at?: string | null
          midpoint_demo_at?: string | null
          no_show_count?: number | null
          notes?: string | null
          on_hold_at?: string | null
          on_hold_expires_at?: string | null
          on_hold_reason?: string | null
          ops_blocked_review_reminder_sent_at?: string | null
          original_tier?: string | null
          owner_approval_requested_at?: string | null
          owner_approved_at?: string | null
          owner_declined_at?: string | null
          polish_hours_budget?: number | null
          polish_hours_used?: number | null
          prior_status?:
            | Database["public"]["Enums"]["spec_project_status"]
            | null
          quebec_eligibility_attested_at?: string | null
          quebec_eligibility_payload?: Json | null
          referrer_email?: string | null
          refunded_at?: string | null
          regulated_workflow_flagged_at?: string | null
          regulated_workflow_flags?: Json | null
          resume_requested_at?: string | null
          resumed_at?: string | null
          retainer_started_at?: string | null
          scope_doc_drafted_at?: string | null
          scope_doc_sent_at?: string | null
          scope_doc_signed_at?: string | null
          scope_doc_url?: string | null
          stalled_at?: string | null
          stalled_reason?: string | null
          status?: Database["public"]["Enums"]["spec_project_status"]
          stripe_customer_id?: string | null
          stripe_session_id?: string | null
          subscription_first_bill_at?: string | null
          subscription_locked_at?: string | null
          subscription_renegotiate_at?: string | null
          support_window_ends_at?: string | null
          tier?: string
          tier_upgraded_at?: string | null
          tos_accepted_at?: string | null
          tos_accepted_ip?: string | null
          tos_version_accepted?: string | null
          updated_at?: string | null
          walkthrough_completed_at?: string | null
          walkthrough_recording_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_projects_account_holder_user_id_fkey"
            columns: ["account_holder_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_projects_buyer_user_id_fkey"
            columns: ["buyer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_projects_linked_company_id_fkey"
            columns: ["linked_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_public_board_snapshot: {
        Row: {
          data: Json
          id: boolean
          refreshed_at: string
        }
        Insert: {
          data: Json
          id?: boolean
          refreshed_at?: string
        }
        Update: {
          data?: Json
          id?: boolean
          refreshed_at?: string
        }
        Relationships: []
      }
      spec_referrals: {
        Row: {
          bounty_cents: number | null
          eligible_at: string | null
          forfeited_at: string | null
          held_reason: string | null
          id: string
          is_test: boolean
          paid_at: string | null
          referrer_email: string
          referrer_name: string | null
          referrer_stripe_account_id: string | null
          related_entity_flag: boolean | null
          related_entity_notes: string | null
          self_referral_flag: boolean | null
          spec_project_id: string
          status: Database["public"]["Enums"]["spec_referral_status"]
          stripe_transfer_id: string | null
          t4a_required: boolean | null
        }
        Insert: {
          bounty_cents?: number | null
          eligible_at?: string | null
          forfeited_at?: string | null
          held_reason?: string | null
          id?: string
          is_test?: boolean
          paid_at?: string | null
          referrer_email: string
          referrer_name?: string | null
          referrer_stripe_account_id?: string | null
          related_entity_flag?: boolean | null
          related_entity_notes?: string | null
          self_referral_flag?: boolean | null
          spec_project_id: string
          status?: Database["public"]["Enums"]["spec_referral_status"]
          stripe_transfer_id?: string | null
          t4a_required?: boolean | null
        }
        Update: {
          bounty_cents?: number | null
          eligible_at?: string | null
          forfeited_at?: string | null
          held_reason?: string | null
          id?: string
          is_test?: boolean
          paid_at?: string | null
          referrer_email?: string
          referrer_name?: string | null
          referrer_stripe_account_id?: string | null
          related_entity_flag?: boolean | null
          related_entity_notes?: string | null
          self_referral_flag?: boolean | null
          spec_project_id?: string
          status?: Database["public"]["Enums"]["spec_referral_status"]
          stripe_transfer_id?: string | null
          t4a_required?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_referrals_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_refund_requests: {
        Row: {
          customer_reason_text: string | null
          denial_reason_text: string | null
          denied_at: string | null
          denied_by_user_id: string | null
          id: string
          internal_note: string | null
          is_goodwill: boolean | null
          is_guarantee_invocation: boolean | null
          is_test: boolean
          processed_at: string | null
          processed_by_user_id: string | null
          refund_breakdown: Json | null
          request_source: Database["public"]["Enums"]["spec_refund_source"]
          requested_at: string | null
          spec_project_id: string
          status: Database["public"]["Enums"]["spec_refund_status"]
          stripe_refund_ids: Json | null
          total_refund_cents: number | null
        }
        Insert: {
          customer_reason_text?: string | null
          denial_reason_text?: string | null
          denied_at?: string | null
          denied_by_user_id?: string | null
          id?: string
          internal_note?: string | null
          is_goodwill?: boolean | null
          is_guarantee_invocation?: boolean | null
          is_test?: boolean
          processed_at?: string | null
          processed_by_user_id?: string | null
          refund_breakdown?: Json | null
          request_source: Database["public"]["Enums"]["spec_refund_source"]
          requested_at?: string | null
          spec_project_id: string
          status?: Database["public"]["Enums"]["spec_refund_status"]
          stripe_refund_ids?: Json | null
          total_refund_cents?: number | null
        }
        Update: {
          customer_reason_text?: string | null
          denial_reason_text?: string | null
          denied_at?: string | null
          denied_by_user_id?: string | null
          id?: string
          internal_note?: string | null
          is_goodwill?: boolean | null
          is_guarantee_invocation?: boolean | null
          is_test?: boolean
          processed_at?: string | null
          processed_by_user_id?: string | null
          refund_breakdown?: Json | null
          request_source?: Database["public"]["Enums"]["spec_refund_source"]
          requested_at?: string | null
          spec_project_id?: string
          status?: Database["public"]["Enums"]["spec_refund_status"]
          stripe_refund_ids?: Json | null
          total_refund_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_refund_requests_denied_by_user_id_fkey"
            columns: ["denied_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_refund_requests_processed_by_user_id_fkey"
            columns: ["processed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_refund_requests_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_retainers: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          id: string
          is_test: boolean
          monthly_amount_cents: number
          paused_at: string | null
          spec_project_id: string
          started_at: string
          status: Database["public"]["Enums"]["spec_retainer_status"]
          stripe_subscription_id: string
          updated_at: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          id?: string
          is_test?: boolean
          monthly_amount_cents: number
          paused_at?: string | null
          spec_project_id: string
          started_at: string
          status?: Database["public"]["Enums"]["spec_retainer_status"]
          stripe_subscription_id: string
          updated_at?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          id?: string
          is_test?: boolean
          monthly_amount_cents?: number
          paused_at?: string | null
          spec_project_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["spec_retainer_status"]
          stripe_subscription_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_retainers_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_satisfaction_ratings: {
        Row: {
          feature_name: string
          id: string
          is_test: boolean
          milestone: string
          notes: string | null
          rating: number
          spec_project_id: string
          submitted_at: string | null
        }
        Insert: {
          feature_name: string
          id?: string
          is_test?: boolean
          milestone: string
          notes?: string | null
          rating: number
          spec_project_id: string
          submitted_at?: string | null
        }
        Update: {
          feature_name?: string
          id?: string
          is_test?: boolean
          milestone?: string
          notes?: string | null
          rating?: number
          spec_project_id?: string
          submitted_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "spec_satisfaction_ratings_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_scope_documents: {
        Row: {
          content_hash: string
          content_json: Json
          drafted_at: string
          external_url: string | null
          id: string
          is_test: boolean
          sent_at: string | null
          spec_project_id: string
          superseded_at: string | null
          version: number
        }
        Insert: {
          content_hash: string
          content_json: Json
          drafted_at?: string
          external_url?: string | null
          id?: string
          is_test?: boolean
          sent_at?: string | null
          spec_project_id: string
          superseded_at?: string | null
          version: number
        }
        Update: {
          content_hash?: string
          content_json?: Json
          drafted_at?: string
          external_url?: string | null
          id?: string
          is_test?: boolean
          sent_at?: string | null
          spec_project_id?: string
          superseded_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "spec_scope_documents_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      spec_support_tickets: {
        Row: {
          customer_classification:
            | Database["public"]["Enums"]["spec_ticket_severity"]
            | null
          description: string
          id: string
          is_in_scope: boolean | null
          is_test: boolean
          linked_change_order_id: string | null
          opened_at: string | null
          phase: Database["public"]["Enums"]["spec_ticket_phase"]
          resolved_at: string | null
          responded_at: string | null
          severity: Database["public"]["Enums"]["spec_ticket_severity"]
          spec_project_id: string
          status: Database["public"]["Enums"]["spec_ticket_status"]
          title: string
        }
        Insert: {
          customer_classification?:
            | Database["public"]["Enums"]["spec_ticket_severity"]
            | null
          description: string
          id?: string
          is_in_scope?: boolean | null
          is_test?: boolean
          linked_change_order_id?: string | null
          opened_at?: string | null
          phase?: Database["public"]["Enums"]["spec_ticket_phase"]
          resolved_at?: string | null
          responded_at?: string | null
          severity: Database["public"]["Enums"]["spec_ticket_severity"]
          spec_project_id: string
          status?: Database["public"]["Enums"]["spec_ticket_status"]
          title: string
        }
        Update: {
          customer_classification?:
            | Database["public"]["Enums"]["spec_ticket_severity"]
            | null
          description?: string
          id?: string
          is_in_scope?: boolean | null
          is_test?: boolean
          linked_change_order_id?: string | null
          opened_at?: string | null
          phase?: Database["public"]["Enums"]["spec_ticket_phase"]
          resolved_at?: string | null
          responded_at?: string | null
          severity?: Database["public"]["Enums"]["spec_ticket_severity"]
          spec_project_id?: string
          status?: Database["public"]["Enums"]["spec_ticket_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "spec_support_tickets_linked_change_order_id_fkey"
            columns: ["linked_change_order_id"]
            isOneToOne: false
            referencedRelation: "spec_change_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "spec_support_tickets_spec_project_id_fkey"
            columns: ["spec_project_id"]
            isOneToOne: false
            referencedRelation: "spec_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_transitions: {
        Row: {
          company_id: string
          duration_in_stage: string | null
          from_stage: string | null
          id: string
          opportunity_id: string
          to_stage: string
          transitioned_at: string
          transitioned_by: string | null
        }
        Insert: {
          company_id: string
          duration_in_stage?: string | null
          from_stage?: string | null
          id?: string
          opportunity_id: string
          to_stage: string
          transitioned_at?: string
          transitioned_by?: string | null
        }
        Update: {
          company_id?: string
          duration_in_stage?: string | null
          from_stage?: string | null
          id?: string
          opportunity_id?: string
          to_stage?: string
          transitioned_at?: string
          transitioned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_transitions_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      streaks: {
        Row: {
          current_streak: number
          id: string
          last_activity_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          current_streak?: number
          id?: string
          last_activity_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          current_streak?: number
          id?: string
          last_activity_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          received_at?: string
        }
        Relationships: []
      }
      sub_clients: {
        Row: {
          address: string | null
          bubble_id: string | null
          client_id: string
          company_id: string
          created_at: string | null
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          phone_number: string | null
          qb_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          bubble_id?: string | null
          client_id: string
          company_id: string
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone_number?: string | null
          qb_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          bubble_id?: string | null
          client_id?: string
          company_id?: string
          created_at?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone_number?: string | null
          qb_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_clients_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      task_material_allocations: {
        Row: {
          allocated_quantity: number
          allocation_key: string
          allocation_status: string
          catalog_stock_unit_id: string | null
          catalog_variant_id: string | null
          company_id: string
          consumed_quantity: number
          created_at: string
          deleted_at: string | null
          demand_id: string | null
          id: string
          inventory_deduction_id: string | null
          overrun_quantity: number
          stock_unit_snapshot: Json
          task_material_id: string | null
          updated_at: string
        }
        Insert: {
          allocated_quantity?: number
          allocation_key: string
          allocation_status?: string
          catalog_stock_unit_id?: string | null
          catalog_variant_id?: string | null
          company_id: string
          consumed_quantity?: number
          created_at?: string
          deleted_at?: string | null
          demand_id?: string | null
          id?: string
          inventory_deduction_id?: string | null
          overrun_quantity?: number
          stock_unit_snapshot?: Json
          task_material_id?: string | null
          updated_at?: string
        }
        Update: {
          allocated_quantity?: number
          allocation_key?: string
          allocation_status?: string
          catalog_stock_unit_id?: string | null
          catalog_variant_id?: string | null
          company_id?: string
          consumed_quantity?: number
          created_at?: string
          deleted_at?: string | null
          demand_id?: string | null
          id?: string
          inventory_deduction_id?: string | null
          overrun_quantity?: number
          stock_unit_snapshot?: Json
          task_material_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_material_allocations_catalog_stock_unit_id_fkey"
            columns: ["catalog_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_stock_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_allocations_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_allocations_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "task_material_allocations_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_allocations_demand_id_fkey"
            columns: ["demand_id"]
            isOneToOne: false
            referencedRelation: "project_material_demands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_allocations_inventory_deduction_id_fkey"
            columns: ["inventory_deduction_id"]
            isOneToOne: false
            referencedRelation: "inventory_deductions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_allocations_task_material_id_fkey"
            columns: ["task_material_id"]
            isOneToOne: false
            referencedRelation: "task_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      task_material_consumption_requests: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          request_hash: string
          response: Json
          status: string
          task_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          request_hash: string
          response?: Json
          status?: string
          task_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          request_hash?: string
          response?: Json
          status?: string
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_material_consumption_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_consumption_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_material_consumption_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_materials: {
        Row: {
          catalog_variant_id: string | null
          id: string
          inventory_item_id: string | null
          quantity: number
          source: string
          task_id: string
        }
        Insert: {
          catalog_variant_id?: string | null
          id?: string
          inventory_item_id?: string | null
          quantity: number
          source?: string
          task_id: string
        }
        Update: {
          catalog_variant_id?: string | null
          id?: string
          inventory_item_id?: string | null
          quantity?: number
          source?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "task_materials_catalog_variant_id_fkey"
            columns: ["catalog_variant_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_materials_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_recurrence_exceptions: {
        Row: {
          action: string
          created_at: string
          id: string
          new_date: string | null
          new_end_time: string | null
          new_start_time: string | null
          new_team_member_ids: string[] | null
          notes: string | null
          original_date: string
          recurrence_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_date?: string | null
          new_end_time?: string | null
          new_start_time?: string | null
          new_team_member_ids?: string[] | null
          notes?: string | null
          original_date: string
          recurrence_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_date?: string | null
          new_end_time?: string | null
          new_start_time?: string | null
          new_team_member_ids?: string[] | null
          notes?: string | null
          original_date?: string
          recurrence_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_recurrence_exceptions_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "task_recurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      task_recurrences: {
        Row: {
          all_day: boolean
          client_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          duration: number
          end_anchor: string | null
          end_time: string | null
          id: string
          next_generation_at: string
          notes: string | null
          project_id: string | null
          rrule: string
          start_anchor: string
          start_time: string | null
          task_type_id: string | null
          team_member_ids: string[]
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          client_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          duration?: number
          end_anchor?: string | null
          end_time?: string | null
          id?: string
          next_generation_at?: string
          notes?: string | null
          project_id?: string | null
          rrule: string
          start_anchor: string
          start_time?: string | null
          task_type_id?: string | null
          team_member_ids?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          client_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          duration?: number
          end_anchor?: string | null
          end_time?: string | null
          id?: string
          next_generation_at?: string
          notes?: string | null
          project_id?: string | null
          rrule?: string
          start_anchor?: string
          start_time?: string | null
          task_type_id?: string | null
          team_member_ids?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_recurrences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
      }
      task_reminders: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          dismissed_at: string | null
          fire_time_local: string
          fires_at: string | null
          id: string
          label: string
          lead_time_days: number
          notified_at: string | null
          recipient_config: Json
          recipient_mode: string
          requires_ack: boolean
          source_template_id: string | null
          task_id: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id: string
          created_at?: string
          deleted_at?: string | null
          dismissed_at?: string | null
          fire_time_local?: string
          fires_at?: string | null
          id?: string
          label: string
          lead_time_days: number
          notified_at?: string | null
          recipient_config?: Json
          recipient_mode: string
          requires_ack: boolean
          source_template_id?: string | null
          task_id: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          dismissed_at?: string | null
          fire_time_local?: string
          fires_at?: string | null
          id?: string
          label?: string
          lead_time_days?: number
          notified_at?: string | null
          recipient_config?: Json
          recipient_mode?: string
          requires_ack?: boolean
          source_template_id?: string | null
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_reminders_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "task_type_reminders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_reminders_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_mutation_events: {
        Row: {
          actor_user_id: string | null
          after_snapshot: Json
          before_snapshot: Json
          company_id: string
          created_at: string
          event_sequence: number
          event_type: string
          id: string
          project_id: string
          task_id: string
          task_schedule_version: number
          task_updated_at: string | null
        }
        Insert: {
          actor_user_id?: string | null
          after_snapshot: Json
          before_snapshot?: Json
          company_id: string
          created_at?: string
          event_sequence?: number
          event_type: string
          id?: string
          project_id: string
          task_id: string
          task_schedule_version: number
          task_updated_at?: string | null
        }
        Update: {
          actor_user_id?: string | null
          after_snapshot?: Json
          before_snapshot?: Json
          company_id?: string
          created_at?: string
          event_sequence?: number
          event_type?: string
          id?: string
          project_id?: string
          task_id?: string
          task_schedule_version?: number
          task_updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_mutation_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mutation_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mutation_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_mutation_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_schedule_automation_outbox: {
        Row: {
          actor_user_id: string | null
          after_snapshot: Json
          attempts: number
          available_at: string
          before_snapshot: Json
          company_id: string
          completed_at: string | null
          disposition: string | null
          id: string
          kind: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          requested_at: string
          result: Json
          status: string
          task_id: string
          task_mutation_event_id: string | null
          task_schedule_version: number
          task_updated_at: string | null
          worker_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          after_snapshot: Json
          attempts?: number
          available_at?: string
          before_snapshot?: Json
          company_id: string
          completed_at?: string | null
          disposition?: string | null
          id?: string
          kind: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          requested_at?: string
          result?: Json
          status?: string
          task_id: string
          task_mutation_event_id?: string | null
          task_schedule_version: number
          task_updated_at?: string | null
          worker_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          after_snapshot?: Json
          attempts?: number
          available_at?: string
          before_snapshot?: Json
          company_id?: string
          completed_at?: string | null
          disposition?: string | null
          id?: string
          kind?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          requested_at?: string
          result?: Json
          status?: string
          task_id?: string
          task_mutation_event_id?: string | null
          task_schedule_version?: number
          task_updated_at?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_schedule_automation_outbox_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_schedule_automation_outbox_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_schedule_automation_outbox_task_mutation_event_id_fkey"
            columns: ["task_mutation_event_id"]
            isOneToOne: true
            referencedRelation: "task_mutation_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_schedule_automation_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_team_members: {
        Row: {
          task_id: string
          user_id: string
        }
        Insert: {
          task_id: string
          user_id: string
        }
        Update: {
          task_id?: string
          user_id?: string
        }
        Relationships: []
      }
      task_templates: {
        Row: {
          company_id: string
          created_at: string | null
          default_team_member_ids: string[] | null
          deleted_at: string | null
          description: string | null
          display_order: number
          estimated_hours: number | null
          id: string
          task_type_id: string
          task_type_ref: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          default_team_member_ids?: string[] | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          estimated_hours?: number | null
          id?: string
          task_type_id: string
          task_type_ref?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          default_team_member_ids?: string[] | null
          deleted_at?: string | null
          description?: string | null
          display_order?: number
          estimated_hours?: number | null
          id?: string
          task_type_id?: string
          task_type_ref?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_task_type_ref_fkey"
            columns: ["task_type_ref"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
      }
      task_type_reminders: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          display_order: number
          fire_time_local: string
          id: string
          label: string
          lead_time_days: number
          recipient_config: Json
          recipient_mode: string
          requires_ack: boolean
          task_type_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          fire_time_local?: string
          id?: string
          label: string
          lead_time_days?: number
          recipient_config?: Json
          recipient_mode?: string
          requires_ack?: boolean
          task_type_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          display_order?: number
          fire_time_local?: string
          id?: string
          label?: string
          lead_time_days?: number
          recipient_config?: Json
          recipient_mode?: string
          requires_ack?: boolean
          task_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_type_reminders_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
      }
      task_types: {
        Row: {
          bubble_id: string | null
          color: string
          company_id: string
          created_at: string | null
          default_duration: number
          default_team_member_ids: string[] | null
          deleted_at: string | null
          dependencies: Json | null
          display: string
          display_order: number | null
          icon: string | null
          id: string
          is_default: boolean | null
          updated_at: string | null
        }
        Insert: {
          bubble_id?: string | null
          color?: string
          company_id: string
          created_at?: string | null
          default_duration?: number
          default_team_member_ids?: string[] | null
          deleted_at?: string | null
          dependencies?: Json | null
          display: string
          display_order?: number | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          updated_at?: string | null
        }
        Update: {
          bubble_id?: string | null
          color?: string
          company_id?: string
          created_at?: string | null
          default_duration?: number
          default_team_member_ids?: string[] | null
          deleted_at?: string | null
          dependencies?: Json | null
          display?: string
          display_order?: number | null
          icon?: string | null
          id?: string
          is_default?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          rate: number
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          rate: number
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          rate?: number
        }
        Relationships: []
      }
      team_invitations: {
        Row: {
          company_id: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invite_code: string
          invited_by: string
          phone: string | null
          role_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invite_code: string
          invited_by: string
          phone?: string | null
          role_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invite_code?: string
          invited_by?: string
          phone?: string | null
          role_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_invitations_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_attributions: {
        Row: {
          attributed_channel: string
          company_id: string
          created_at: string
          fbclid: string | null
          first_paid_at: string | null
          gclid: string | null
          id: string
          landing_url: string | null
          trial_started_at: string
          updated_at: string
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          attributed_channel?: string
          company_id: string
          created_at?: string
          fbclid?: string | null
          first_paid_at?: string | null
          gclid?: string | null
          id?: string
          landing_url?: string | null
          trial_started_at: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          attributed_channel?: string
          company_id?: string
          created_at?: string
          fbclid?: string | null
          first_paid_at?: string | null
          gclid?: string | null
          id?: string
          landing_url?: string | null
          trial_started_at?: string
          updated_at?: string
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trial_attributions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_expiry_notifications: {
        Row: {
          company_id: string
          created_at: string
          id: string
          notification_type: string
          promo_code_30: string | null
          promo_code_50: string | null
          sent_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          notification_type: string
          promo_code_30?: string | null
          promo_code_50?: string | null
          sent_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          notification_type?: string
          promo_code_30?: string | null
          promo_code_50?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trial_expiry_notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tutorial_analytics: {
        Row: {
          action: string
          created_at: string | null
          duration_ms: number | null
          flow_type: string
          id: string
          phase: string
          phase_index: number
          platform: string
          session_id: string
          total_elapsed_ms: number | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          duration_ms?: number | null
          flow_type: string
          id?: string
          phase: string
          phase_index: number
          platform: string
          session_id: string
          total_elapsed_ms?: number | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          duration_ms?: number | null
          flow_type?: string
          id?: string
          phase?: string
          phase_index?: number
          platform?: string
          session_id?: string
          total_elapsed_ms?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      unassigned_lead_assignment_deliveries: {
        Row: {
          assignment_version: number
          attempts: number
          available_at: string
          claimed_at: string | null
          claimed_by: string | null
          company_id: string
          connection_id: string
          created_at: string
          delivered_at: string | null
          disposition: string | null
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          max_attempts: number
          notification_id: string | null
          opportunity_id: string
          push_state: string
          recipient_user_id: string
          state: string
          terminal_at: string | null
          updated_at: string
        }
        Insert: {
          assignment_version?: number
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          company_id: string
          connection_id: string
          created_at?: string
          delivered_at?: string | null
          disposition?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          notification_id?: string | null
          opportunity_id: string
          push_state?: string
          recipient_user_id: string
          state?: string
          terminal_at?: string | null
          updated_at?: string
        }
        Update: {
          assignment_version?: number
          attempts?: number
          available_at?: string
          claimed_at?: string | null
          claimed_by?: string | null
          company_id?: string
          connection_id?: string
          created_at?: string
          delivered_at?: string | null
          disposition?: string | null
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          max_attempts?: number
          notification_id?: string | null
          opportunity_id?: string
          push_state?: string
          recipient_user_id?: string
          state?: string
          terminal_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unassigned_lead_assignment_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unassigned_lead_assignment_deliveries_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "email_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unassigned_lead_assignment_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unassigned_lead_assignment_deliveries_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unassigned_lead_assignment_deliveries_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dashboard_preferences: {
        Row: {
          company_id: string
          created_at: string | null
          dashboard_layout: string | null
          id: string
          map_default_center: Json | null
          map_default_zoom: number | null
          map_show_crew_labels: boolean | null
          map_show_traffic: boolean | null
          scheduling_type: string | null
          updated_at: string | null
          user_id: string
          widget_instances: Json
        }
        Insert: {
          company_id: string
          created_at?: string | null
          dashboard_layout?: string | null
          id?: string
          map_default_center?: Json | null
          map_default_zoom?: number | null
          map_show_crew_labels?: boolean | null
          map_show_traffic?: boolean | null
          scheduling_type?: string | null
          updated_at?: string | null
          user_id: string
          widget_instances?: Json
        }
        Update: {
          company_id?: string
          created_at?: string | null
          dashboard_layout?: string | null
          id?: string
          map_default_center?: Json | null
          map_default_zoom?: number | null
          map_show_crew_labels?: boolean | null
          map_show_traffic?: boolean | null
          scheduling_type?: string | null
          updated_at?: string | null
          user_id?: string
          widget_instances?: Json
        }
        Relationships: [
          {
            foreignKeyName: "user_dashboard_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permission_overrides: {
        Row: {
          company_id: string
          created_at: string | null
          granted: boolean
          id: string
          permission: string
          scope: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          granted?: boolean
          id?: string
          permission: string
          scope?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          granted?: boolean
          id?: string
          permission?: string
          scope?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_id: string | null
          bubble_id: string | null
          client_id: string | null
          company_id: string | null
          created_at: string | null
          deleted_at: string | null
          dev_permission: boolean | null
          device_token: string | null
          email: string | null
          email_domain_valid: boolean | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          fab_actions: string[] | null
          firebase_uid: string | null
          first_name: string
          has_completed_tutorial: boolean | null
          home_address: string | null
          id: string
          is_active: boolean | null
          is_company_admin: boolean | null
          last_name: string
          latitude: number | null
          location_name: string | null
          longitude: number | null
          onboarding_completed: Json | null
          onesignal_player_id: string | null
          phone: string | null
          preferences: Json
          profile_image_url: string | null
          removed_from_email_list: boolean | null
          removed_from_email_list_at: string | null
          role: string | null
          setup_progress: Json | null
          special_permissions: string[] | null
          stripe_customer_id: string | null
          updated_at: string | null
          user_color: string | null
          user_type: string | null
        }
        Insert: {
          auth_id?: string | null
          bubble_id?: string | null
          client_id?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dev_permission?: boolean | null
          device_token?: string | null
          email?: string | null
          email_domain_valid?: boolean | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          fab_actions?: string[] | null
          firebase_uid?: string | null
          first_name: string
          has_completed_tutorial?: boolean | null
          home_address?: string | null
          id?: string
          is_active?: boolean | null
          is_company_admin?: boolean | null
          last_name: string
          latitude?: number | null
          location_name?: string | null
          longitude?: number | null
          onboarding_completed?: Json | null
          onesignal_player_id?: string | null
          phone?: string | null
          preferences?: Json
          profile_image_url?: string | null
          removed_from_email_list?: boolean | null
          removed_from_email_list_at?: string | null
          role?: string | null
          setup_progress?: Json | null
          special_permissions?: string[] | null
          stripe_customer_id?: string | null
          updated_at?: string | null
          user_color?: string | null
          user_type?: string | null
        }
        Update: {
          auth_id?: string | null
          bubble_id?: string | null
          client_id?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dev_permission?: boolean | null
          device_token?: string | null
          email?: string | null
          email_domain_valid?: boolean | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          fab_actions?: string[] | null
          firebase_uid?: string | null
          first_name?: string
          has_completed_tutorial?: boolean | null
          home_address?: string | null
          id?: string
          is_active?: boolean | null
          is_company_admin?: boolean | null
          last_name?: string
          latitude?: number | null
          location_name?: string | null
          longitude?: number | null
          onboarding_completed?: Json | null
          onesignal_player_id?: string | null
          phone?: string | null
          preferences?: Json
          profile_image_url?: string | null
          removed_from_email_list?: boolean | null
          removed_from_email_list_at?: string | null
          role?: string | null
          setup_progress?: Json | null
          special_permissions?: string[] | null
          stripe_customer_id?: string | null
          updated_at?: string | null
          user_color?: string | null
          user_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      valid_status_transitions: {
        Row: {
          entity_type: string
          from_status: string
          to_status: string
        }
        Insert: {
          entity_type: string
          from_status: string
          to_status: string
        }
        Update: {
          entity_type?: string
          from_status?: string
          to_status?: string
        }
        Relationships: []
      }
      weather_forecasts: {
        Row: {
          company_id: string
          conditions: string | null
          forecast_date: string
          id: string
          precipitation_mm: number | null
          precipitation_probability: number | null
          project_id: string
          retrieved_at: string
          source: string
          temp_current_c: number | null
          temp_high_c: number | null
          temp_low_c: number | null
          wind_speed_kmh: number | null
        }
        Insert: {
          company_id: string
          conditions?: string | null
          forecast_date: string
          id?: string
          precipitation_mm?: number | null
          precipitation_probability?: number | null
          project_id: string
          retrieved_at?: string
          source?: string
          temp_current_c?: number | null
          temp_high_c?: number | null
          temp_low_c?: number | null
          wind_speed_kmh?: number | null
        }
        Update: {
          company_id?: string
          conditions?: string | null
          forecast_date?: string
          id?: string
          precipitation_mm?: number | null
          precipitation_probability?: number | null
          project_id?: string
          retrieved_at?: string
          source?: string
          temp_current_c?: number | null
          temp_high_c?: number | null
          temp_low_c?: number | null
          wind_speed_kmh?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "weather_forecasts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_forecasts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_table_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_forecasts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      whats_new_categories: {
        Row: {
          created_at: string
          icon: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      whats_new_items: {
        Row: {
          category_id: string
          created_at: string
          description: string
          feature_flag_slug: string | null
          icon: string
          id: string
          is_active: boolean
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          description?: string
          feature_flag_slug?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          description?: string
          feature_flag_slug?: string | null
          icon?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whats_new_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "whats_new_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      wizard_analytics: {
        Row: {
          company_id: string | null
          created_at: string | null
          duration_ms: number | null
          event: string
          id: string
          is_restart: boolean | null
          platform: string
          session_id: string
          step_id: string | null
          step_index: number | null
          steps_skipped: number | null
          total_steps: number | null
          trigger_context: string | null
          trigger_type: string | null
          user_id: string | null
          user_role: string | null
          wizard_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          event: string
          id?: string
          is_restart?: boolean | null
          platform?: string
          session_id: string
          step_id?: string | null
          step_index?: number | null
          steps_skipped?: number | null
          total_steps?: number | null
          trigger_context?: string | null
          trigger_type?: string | null
          user_id?: string | null
          user_role?: string | null
          wizard_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          duration_ms?: number | null
          event?: string
          id?: string
          is_restart?: boolean | null
          platform?: string
          session_id?: string
          step_id?: string | null
          step_index?: number | null
          steps_skipped?: number | null
          total_steps?: number | null
          trigger_context?: string | null
          trigger_type?: string | null
          user_id?: string | null
          user_role?: string | null
          wizard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wizard_analytics_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      wizard_states: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_session_id: string
          current_step_index: number
          do_not_show: boolean
          id: string
          last_active_at: string | null
          status: string
          steps_skipped: number
          total_duration_ms: number
          updated_at: string | null
          user_id: string
          wizard_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_session_id: string
          current_step_index?: number
          do_not_show?: boolean
          id?: string
          last_active_at?: string | null
          status?: string
          steps_skipped?: number
          total_duration_ms?: number
          updated_at?: string | null
          user_id: string
          wizard_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_session_id?: string
          current_step_index?: number
          do_not_show?: boolean
          id?: string
          last_active_at?: string | null
          status?: string
          steps_skipped?: number
          total_duration_ms?: number
          updated_at?: string | null
          user_id?: string
          wizard_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      inventory_item_tags: {
        Row: {
          id: string | null
          item_id: string | null
          tag_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "catalog_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "inventory_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          company_id: string | null
          created_at: string | null
          critical_threshold: number | null
          deleted_at: string | null
          description: string | null
          id: string | null
          image_url: string | null
          name: string | null
          notes: string | null
          quantity: number | null
          sku: string | null
          unit_id: string | null
          updated_at: string | null
          warning_threshold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_variants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variants_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "catalog_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_variants_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "inventory_units"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_snapshot_items: {
        Row: {
          description: string | null
          id: string | null
          name: string | null
          original_item_id: string | null
          quantity: number | null
          sku: string | null
          snapshot_id: string | null
          tags_string: string | null
          unit_display: string | null
        }
        Insert: {
          description?: string | null
          id?: string | null
          name?: string | null
          original_item_id?: string | null
          quantity?: number | null
          sku?: string | null
          snapshot_id?: string | null
          tags_string?: never
          unit_display?: string | null
        }
        Update: {
          description?: string | null
          id?: string | null
          name?: string | null
          original_item_id?: string | null
          quantity?: number | null
          sku?: string | null
          snapshot_id?: string | null
          tags_string?: never
          unit_display?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_snapshot_items_original_variant_id_fkey"
            columns: ["original_item_id"]
            isOneToOne: false
            referencedRelation: "catalog_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_original_variant_id_fkey"
            columns: ["original_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_item_tags"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_original_variant_id_fkey"
            columns: ["original_item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "catalog_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshot_items_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "inventory_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_snapshots: {
        Row: {
          company_id: string | null
          created_at: string | null
          created_by_id: string | null
          id: string | null
          is_automatic: boolean | null
          item_count: number | null
          notes: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          created_by_id?: string | null
          id?: string | null
          is_automatic?: boolean | null
          item_count?: number | null
          notes?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          created_by_id?: string | null
          id?: string | null
          is_automatic?: boolean | null
          item_count?: number | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_snapshots_created_by_id_fkey"
            columns: ["created_by_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_tags: {
        Row: {
          company_id: string | null
          created_at: string | null
          critical_threshold: number | null
          deleted_at: string | null
          id: string | null
          name: string | null
          updated_at: string | null
          warning_threshold: number | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          critical_threshold?: number | null
          deleted_at?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
          warning_threshold?: number | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          critical_threshold?: number | null
          deleted_at?: string | null
          id?: string | null
          name?: string | null
          updated_at?: string | null
          warning_threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_tags_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_units: {
        Row: {
          abbreviation: string | null
          company_id: string | null
          created_at: string | null
          deleted_at: string | null
          dimension: string | null
          display: string | null
          id: string | null
          is_default: boolean | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          abbreviation?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dimension?: string | null
          display?: string | null
          id?: string | null
          is_default?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          abbreviation?: string | null
          company_id?: string | null
          created_at?: string | null
          deleted_at?: string | null
          dimension?: string | null
          display?: string | null
          id?: string | null
          is_default?: boolean | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_units_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_table_rows: {
        Row: {
          address: string | null
          client_email: string | null
          client_id: string | null
          client_name: string | null
          client_phone: string | null
          company_id: string | null
          completed_at: string | null
          created_at: string | null
          days_in_status: number | null
          duration: number | null
          end_date: string | null
          estimate_total: number | null
          id: string | null
          invoice_total: number | null
          margin: number | null
          next_task: string | null
          notes: string | null
          paid_total: number | null
          photo_count: number | null
          progress: number | null
          project_cost: number | null
          start_date: string | null
          status: string | null
          task_completed_count: number | null
          task_count: number | null
          team_member_ids: string[] | null
          title: string | null
          trade: string | null
          updated_at: string | null
          value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _record_client_merge_skip: {
        Args: {
          p_company_id: string
          p_confirmed_overrides: Json
          p_error_message: string
          p_field_fill: Json
          p_guard_reason: string
          p_loser_id: string
          p_merge_key: string
          p_resolved_by: string
          p_review_id: string
          p_run_id: string
          p_winner_id: string
        }
        Returns: Json
      }
      _record_opportunity_merge_skip: {
        Args: {
          p_company_id: string
          p_confirmed_overrides: Json
          p_error_message: string
          p_field_fill: Json
          p_guard_reason: string
          p_loser_id: string
          p_merge_key: string
          p_resolved_by: string
          p_review_id: string
          p_run_id: string
          p_winner_id: string
        }
        Returns: Json
      }
      accept_estimate_to_job: {
        Args: { p_estimate_id: string; p_idempotency_key: string }
        Returns: Json
      }
      acquire_email_connection_sync_lock_as_system: {
        Args: { p_connection_id: string; p_lease_seconds?: number }
        Returns: string
      }
      renew_email_connection_sync_lock_as_system: {
        Args: {
          p_connection_id: string
          p_lease_seconds?: number
          p_owner_id: string
        }
        Returns: boolean
      }
      release_email_connection_sync_lock_as_system: {
        Args: { p_connection_id: string; p_owner_id: string }
        Returns: boolean
      }
      persist_email_connection_recovery_checkpoint_as_system: {
        Args: {
          p_anchor: string
          p_connection_id: string
          p_owner_id: string
          p_page_token: string
          p_target_token: string
        }
        Returns: boolean
      }
      persist_email_connection_sync_completion_as_system: {
        Args: {
          p_clear_recovery?: boolean
          p_connection_id: string
          p_history_id: string
          p_last_synced_at: string
          p_owner_id: string
        }
        Returns: boolean
      }
      complete_gmail_import_job_as_system: {
        Args: {
          p_clients_created: number
          p_completed_at: string
          p_connection_id: string
          p_history_id: string
          p_job_id: string
          p_leads_created: number
          p_matched: number
          p_needs_review: number
          p_owner_id: string
          p_processed: number
          p_unmatched: number
        }
        Returns: boolean
      }
      acquire_phase_c_lock: {
        Args: { p_holder: string; p_job_id: string; p_lease_seconds?: number }
        Returns: boolean
      }
      apply_email_outbound_learning: {
        Args: { p_job_id: string; p_lease_token: string }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_email_outbound_learning_legacy_internal: {
        Args: { p_job_id: string; p_lease_token: string }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_expense_batch: {
        Args: { p_batch_id: string }
        Returns: undefined
      }
      archive_opportunity_table_view: {
        Args: { p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "opportunity_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      archive_project_table_view: {
        Args: { p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "project_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      authorize_email_inbox_action_as_system: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_connection_id: string
          p_opportunity_id: string | null
        }
        Returns: boolean
      }
      abandon_exact_message_recovery_work_as_system: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
          p_entry_sha256: string
          p_manifest_sha256: string
          p_provider_message_id: string
          p_provider_thread_id: string
          p_superseding_entry_sha256: string
          p_superseding_manifest_sha256: string
        }
        Returns: boolean
      }
      authorize_email_exact_message_ingest_as_system: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
        }
        Returns: boolean
      }
      claim_legacy_email_activity_connection_as_system: {
        Args: {
          p_activity_id: string
          p_company_id: string
          p_connection_id: string
          p_provider_message_id: string
          p_provider_thread_id: string
        }
        Returns: boolean
      }
      inspect_exact_message_recovery_application_as_system: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_entry_sha256: string
          p_manifest_sha256: string
          p_provider_message_id: string
          p_provider_thread_id: string
        }
        Returns: Json
      }
      inspect_exact_message_recovery_work_as_system: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_entry_sha256: string
          p_manifest_sha256: string
          p_provider_message_id: string
          p_provider_thread_id: string
        }
        Returns: Json
      }
      mark_exact_message_recovery_work_step_as_system: {
        Args: {
          p_actor_user_id: string
          p_activity_id: string | null
          p_company_id: string
          p_connection_id: string
          p_correspondence_event_id: string | null
          p_entry_sha256: string
          p_manifest_sha256: string
          p_opportunity_id: string | null
          p_provider_message_id: string
          p_provider_thread_id: string
          p_source_opportunity_id: string | null
          p_step: string
          p_target_opportunity_id: string | null
        }
        Returns: Json
      }
      register_exact_message_recovery_work_as_system: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_activity_id: string | null
          p_attachment_required: boolean
          p_company_id: string
          p_connection_id: string
          p_correspondence_event_id: string | null
          p_draft_projection_required: boolean
          p_entry_sha256: string
          p_manifest_cutoff_at: string
          p_manifest_generated_at: string
          p_manifest_sha256: string
          p_message_payload: Json
          p_opportunity_id: string | null
          p_provider_message_id: string
          p_provider_thread_id: string
          p_repair_required: boolean
          p_source_opportunity_id: string | null
          p_target_opportunity_id: string | null
        }
        Returns: Json
      }
      authorize_email_thread_data_review_as_system: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
          p_kind: string
          p_provider_thread_id: string
        }
        Returns: boolean
      }
      authorize_task_action_as_system: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_task_id: string
        }
        Returns: boolean
      }
      authorize_task_status_change_as_system: {
        Args: { p_actor_user_id: string; p_task_id: string }
        Returns: boolean
      }
      assign_project_team_member: {
        Args: {
          p_expected_updated_at: string
          p_project_id: string
          p_task_ids: string[]
          p_user_id: string
        }
        Returns: Json
      }
      bulk_update_project_table: {
        Args: { p_operations: Json }
        Returns: Json
      }
      campaign_engagement_stats: {
        Args: { p_campaign_id: string }
        Returns: Json
      }
      campaign_funnel_stages: {
        Args: { p_campaign_id: string }
        Returns: {
          stage: string
          value: number
        }[]
      }
      catalog_import_apply: {
        Args: { p_company_id: string; p_payload: Json }
        Returns: Json
      }
      catalog_import_validate: {
        Args: { p_company_id: string; p_payload: Json }
        Returns: Json
      }
      catalog_setup_save: {
        Args: {
          p_company_id: string
          p_idempotency_key: string
          p_payload: Json
        }
        Returns: Json
      }
      change_project_status: {
        Args: {
          p_expected_status_version: number
          p_expected_updated_at: string
          p_new_status: string
          p_project_id: string
        }
        Returns: Json
      }
      change_project_status_as_system: {
        Args: {
          p_actor_user_id: string
          p_expected_status: string
          p_expected_status_version: number
          p_expected_updated_at: string
          p_new_status: string
          p_project_id: string
        }
        Returns: Json
      }
      check_pending_invites: { Args: { p_email: string }; Returns: Json }
      check_user_exists_by_email: {
        Args: { p_email: string }
        Returns: {
          user_exists: boolean
        }[]
      }
      claim_email_attachment_scan: {
        Args: {
          p_activity_id: string
          p_company_id: string
          p_connection_id: string
          p_lease_seconds?: number
          p_message_id: string
          p_worker_id: string
        }
        Returns: Database["public"]["Tables"]["email_attachment_scans"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "email_attachment_scans"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_email_attachment_scans: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: Database["public"]["Tables"]["email_attachment_scans"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "email_attachment_scans"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_email_attachment_inspection_job: {
        Args: {
          p_email_attachment_id: string
          p_lease_seconds?: number
          p_worker_id: string
        }
        Returns: Database["public"]["Tables"]["email_attachment_inspection_jobs"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "email_attachment_inspection_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_email_attachment_inspection_jobs: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: Database["public"]["Tables"]["email_attachment_inspection_jobs"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "email_attachment_inspection_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_email_jobs: {
        Args: { p_limit?: number }
        Returns: {
          campaign_id: string
          id: string
          recipient_email: string
          recipient_user_id: string
          retry_count: number
          template_payload: Json
        }[]
      }
      claim_email_outbound_learning: {
        Args: { p_lease_seconds?: number; p_limit?: number }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"][]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_project_status_lifecycle_events: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          actor_user_id: string | null
          attempt: number
          company_id: string
          event_id: string
          lease_token: string
          new_status: string
          old_status: string
          project_id: string
          project_status_version: number
          project_updated_at: string
          requested_at: string
        }[]
      }
      claim_opportunity_conversion_notification_deliveries: {
        Args: { p_lease_seconds?: number; p_worker_id: string }
        Returns: {
          actor_user_id: string | null
          company_id: string
          conversion_event_id: string
          delivery_id: string
          delivery_lease_token: string | null
          destination: string | null
          disposition: string
          lead_title: string
          notification_id: string | null
          opportunity_id: string
          project_id: string
          recipient_user_id: string
          requires_notification: boolean
          should_push: boolean
        }[]
      }
      claim_unassigned_lead_assignment_deliveries: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          company_id: string
          delivery_id: string
          delivery_lease_token: string | null
          disposition: string
          lead_title: string
          notification_id: string | null
          opportunity_id: string
          recipient_user_id: string
          requires_notification: boolean
          should_push: boolean
        }[]
      }
      claim_task_schedule_automation_events: {
        Args: {
          p_lease_seconds?: number
          p_limit?: number
          p_worker_id: string
        }
        Returns: {
          actor_user_id: string | null
          after_snapshot: Json
          attempt: number
          before_snapshot: Json
          company_id: string
          event_id: string
          kind: string
          lease_token: string
          task_id: string
          task_schedule_version: number
          task_updated_at: string | null
        }[]
      }
      complete_email_analysis_job_as_system: {
        Args: {
          p_actor_user_id: string
          p_job_id: string
          p_progress: Json
          p_result: Json
        }
        Returns: Json
      }
      complete_project_status_lifecycle_event: {
        Args: { p_event_id: string; p_lease_token: string }
        Returns: boolean
      }
      complete_opportunity_conversion_notification_delivery: {
        Args: {
          p_delivery_id: string
          p_lease_token: string
          p_push_state: string
        }
        Returns: Json
      }
      complete_unassigned_lead_assignment_delivery: {
        Args: {
          p_delivery_id: string
          p_lease_token: string
          p_push_state: string
        }
        Returns: Json
      }
      complete_task_schedule_automation_event: {
        Args: {
          p_disposition?: string
          p_event_id: string
          p_lease_token: string
          p_result?: Json
        }
        Returns: boolean
      }
      complete_project_task: {
        Args: {
          p_idempotency_key: string
          p_material_adjustments?: Json
          p_task_id: string
        }
        Returns: Json
      }
      commit_lead_summary_snapshot: {
        Args: {
          p_company_id: string
          p_expected_assignment_version: number
          p_expected_correspondence_count: number
          p_expected_latest_meaningful_event_id: string | null
          p_expected_meaningful_event_count: number
          p_expected_opportunity_updated_at: string
          p_expected_prior_summary: string | null
          p_expected_prior_summary_updated_at: string | null
          p_generated_at: string
          p_opportunity_id: string
          p_summary: string
        }
        Returns: {
          changed: boolean
          guard_reason: string | null
          summary_updated_at: string | null
        }[]
      }
      consume_email_oauth_state: {
        Args: { p_nonce_hash: string; p_provider: string }
        Returns: {
          company_id: string
          connection_id: string | null
          connection_type: string
          expected_email: string | null
          source: string
          user_id: string
        }[]
      }
      compute_reminder_fires_at: {
        Args: {
          p_company_id: string
          p_fire_time_local: string
          p_lead_time_days: number
          p_task_start_date: string
        }
        Returns: string
      }
      configure_company_mailbox_intake_owner_as_system: {
        Args: {
          p_actor_user_id: string
          p_connection_id: string
          p_expected_owner_id: string | null
          p_new_owner_id: string | null
        }
        Returns: Json
      }
      convert_estimate_to_invoice: {
        Args: { p_due_date?: string; p_estimate_id: string }
        Returns: string
      }
      convert_lead_to_project: {
        Args: {
          p_actual_value: number
          p_address: string
          p_opportunity_id: string
          p_title: string
          p_user_id: string
        }
        Returns: string
      }
      convert_opportunity_to_project: {
        Args: {
          p_actual_value?: number
          p_company_id: string
          p_decided_by?: string
          p_evidence?: Json
          p_expected_assignment_version?: number
          p_expected_stage?: string
          p_link_to_project_id?: string
          p_notes?: string
          p_opportunity_id: string
          p_project_status?: string
          p_source_path?: string
          p_title_override?: string
          p_win_opportunity?: boolean
        }
        Returns: Json
      }
      count_distinct_users: {
        Args: {
          end_date: string
          platform_filter?: string
          start_date: string
        }
        Returns: number
      }
      create_target_and_reparent_opportunity_email_message_guarded: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
          p_entry_sha256: string
          p_expected_activity_id: string
          p_expected_correspondence_event_id: string
          p_expected_source_assigned_to: string | null
          p_expected_source_assignment_version: number
          p_expected_source_project_id: string | null
          p_expected_source_stage: string
          p_expected_source_stage_manually_set: boolean
          p_expected_source_updated_at: string
          p_manifest_sha256: string
          p_provider_message_id: string
          p_provider_thread_id: string
          p_source_opportunity_id: string
          p_target_contact_name: string | null
          p_target_email: string
          p_target_source_thread_key: string
          p_target_title: string
        }
        Returns: Json
      }
      create_notification_if_new: {
        Args: {
          p_action_label?: string
          p_action_url?: string
          p_body: string
          p_company_id: string
          p_dedupe_key?: string
          p_deep_link_type?: string
          p_persistent?: boolean
          p_project_id?: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: undefined
      }
      create_notification_if_new_with_status: {
        Args: {
          p_action_label?: string
          p_action_url?: string
          p_body: string
          p_company_id: string
          p_dedupe_key?: string
          p_deep_link_type?: string
          p_persistent?: boolean
          p_project_id?: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: boolean
      }
      create_notification_if_new_with_identity: {
        Args: {
          p_action_label?: string
          p_action_url?: string
          p_body: string
          p_company_id: string
          p_dedupe_key?: string
          p_deep_link_type?: string
          p_persistent?: boolean
          p_project_id?: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: {
          created: boolean
          incident_version: number
          notification_id: string
        }[]
      }
      create_opportunity_table_view: {
        Args: { p_definition: Json; p_name: string; p_source_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "opportunity_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_progress_invoice: {
        Args: { p_estimate_id: string; p_line_item_selections: Json }
        Returns: string
      }
      create_project_table_assignment_task: {
        Args: {
          p_expected_updated_at: string
          p_project_id: string
          p_title: string
        }
        Returns: Json
      }
      create_project_table_view: {
        Args: { p_definition: Json; p_name: string; p_source_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "project_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_task_with_event: {
        Args: {
          p_payload?: Json
          p_project_id: string
          p_task_id: string
          p_task_type_id: string
        }
        Returns: Json
      }
      create_task_with_event_as_system: {
        Args: {
          p_actor_user_id: string
          p_custom_title: string
          p_duration?: number
          p_end_date?: string
          p_project_id: string
          p_start_date?: string
          p_task_color?: string
          p_task_id: string
          p_task_notes?: string
          p_task_type_id: string
          p_team_member_ids?: string[]
        }
        Returns: Json
      }
      defer_email_outbound_learning: {
        Args: {
          p_delay_seconds?: number
          p_job_id: string
          p_lease_token: string
          p_reason: string
        }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      diagnose_email_outbound_learning: {
        Args: {
          p_before_id?: string
          p_before_sort_at?: string
          p_company_id?: string
          p_limit?: number
          p_status?: string
        }
        Returns: {
          applied_at: string
          attempts: number
          company_id: string
          completed_at: string
          connection_id: string
          created_at: string
          draft_delivery_channel: string
          draft_history_id: string
          follow_up_draft_id: string
          has_learning_receipt: boolean
          id: string
          is_prepared: boolean
          last_error: string
          last_failed_at: string
          last_requeue_reason: string
          last_requeued_at: string
          last_terminal_error: string
          lease_expires_at: string
          max_attempts: number
          next_attempt_at: string
          occurred_at: string
          opportunity_id: string
          provider_message_id: string
          provider_thread_id: string
          requeue_count: number
          status: string
          updated_at: string
          user_id: string
        }[]
      }
      create_company_mailbox_email_opportunity_as_system: {
        Args: {
          p_connection_id: string
          p_ingestion_source: string
          p_opportunity: Json
          p_provider_mutations_disabled: boolean
          p_provider_thread_id: string
        }
        Returns: Json
      }
      early_clear_expense_line: {
        Args: { p_expense_id: string }
        Returns: undefined
      }
      email_audience_clause_to_sql: {
        Args: {
          p_alias_companies?: string
          p_alias_users?: string
          p_clause: Json
        }
        Returns: string
      }
      email_audience_count: { Args: { p_filter: Json }; Returns: number }
      email_audience_filter: {
        Args: { p_filter: Json }
        Returns: {
          email: string
          user_id: string
        }[]
      }
      email_audience_node_to_sql: {
        Args: {
          p_alias_companies?: string
          p_alias_users?: string
          p_node: Json
        }
        Returns: string
      }
      email_event_metrics: {
        Args: { p_bucket?: string; p_minutes_back?: number }
        Returns: Json
      }
      email_funnel_counts: { Args: never; Returns: Json }
      email_segment_counts: { Args: never; Returns: Json }
      email_top_bounce_domains: {
        Args: { p_limit?: number; p_minutes_back?: number }
        Returns: {
          bounce_count: number
          bounce_pct: number
          domain: string
        }[]
      }
      enqueue_email_signature_notification_lifecycle: {
        Args: {
          p_actor_user_id: string
          p_connection_id: string
          p_reason: string
        }
        Returns: undefined
      }
      fail_email_signature_notification_lifecycle: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
          p_error: string
          p_expected_requested_at: string
        }
        Returns: boolean
      }
      fail_project_status_lifecycle_event: {
        Args: {
          p_error: string
          p_event_id: string
          p_lease_token: string
          p_retryable?: boolean
        }
        Returns: string
      }
      fail_opportunity_conversion_notification_delivery: {
        Args: {
          p_delivery_id: string
          p_error: string
          p_lease_token: string
          p_retryable?: boolean
        }
        Returns: Json
      }
      fail_unassigned_lead_assignment_delivery: {
        Args: {
          p_delivery_id: string
          p_error: string
          p_lease_token: string
          p_retryable?: boolean
        }
        Returns: Json
      }
      fail_task_schedule_automation_event: {
        Args: {
          p_error: string
          p_event_id: string
          p_lease_token: string
          p_retryable?: boolean
        }
        Returns: string
      }
      finalize_exhausted_task_schedule_automation_events: {
        Args: never
        Returns: number
      }
      enqueue_email_outbound_learning: {
        Args: {
          p_authored_body?: string
          p_clean_body?: string
          p_company_id: string
          p_connection_id: string
          p_draft_delivery_channel?: string
          p_draft_history_id?: string
          p_follow_up_draft_id?: string
          p_from_email?: string
          p_learning_authority?: string
          p_occurred_at?: string
          p_opportunity_id?: string
          p_profile_type?: string
          p_provider_message_id: string
          p_provider_thread_id?: string
          p_subject?: string
          p_to_emails?: string[]
          p_user_id?: string
        }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_human_draft_accuracy_as_system: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_limit?: number
          p_profile_types?: string[] | null
        }
        Returns: {
          draft_outcome: Json | null
          profile_type: string
        }[]
      }
      list_phase_c_graduation_actor_scopes_as_system: {
        Args: { p_limit?: number }
        Returns: {
          actor_user_id: string
          company_id: string
          connection_id: string
        }[]
      }
      resolve_email_outbound_learning_mailbox_actor_as_system: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_draft_history_id: string
          p_outcome: string
          p_provider_message_id: string
          p_provider_thread_id: string
        }
        Returns: Json
      }
      enqueue_email_outbound_learning_legacy_internal: {
        Args: {
          p_authored_body?: string
          p_clean_body?: string
          p_company_id: string
          p_connection_id: string
          p_draft_delivery_channel?: string
          p_draft_history_id?: string
          p_follow_up_draft_id?: string
          p_from_email?: string
          p_occurred_at?: string
          p_opportunity_id?: string
          p_provider_message_id: string
          p_provider_thread_id?: string
          p_subject?: string
          p_to_emails?: string[]
          p_user_id?: string
        }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      execute_client_merge_guarded: {
        Args: {
          p_company_id: string
          p_confirmed_overrides?: Json
          p_expected_loser_updated_at?: string
          p_expected_winner_updated_at?: string
          p_field_fill?: Json
          p_loser_id: string
          p_merge_key: string
          p_resolved_by?: string
          p_review_id?: string
          p_run_id?: string
          p_winner_id: string
        }
        Returns: Json
      }
      execute_opportunity_lifecycle_guarded_action: {
        Args: {
          p_action: string
          p_after_values: Json
          p_approved_action_key: string
          p_approved_at?: string
          p_approved_by?: string
          p_before_values: Json
          p_company_id: string
          p_decision_evidence?: Json
          p_decision_reason?: string
          p_expected_archived_at: string
          p_expected_deleted_at: string
          p_expected_project_id: string
          p_expected_project_ref: string
          p_expected_stage: string
          p_opportunity_id: string
          p_run_id?: string
          p_runner?: string
        }
        Returns: Json
      }
      execute_opportunity_merge_guarded: {
        Args: {
          p_company_id: string
          p_confirmed_overrides?: Json
          p_expected_loser_stage?: string
          p_expected_winner_stage?: string
          p_field_fill?: Json
          p_loser_id: string
          p_merge_key: string
          p_resolved_by?: string
          p_review_id?: string
          p_run_id?: string
          p_winner_id: string
        }
        Returns: Json
      }
      execute_opportunity_merge_guarded_internal: {
        Args: {
          p_company_id: string
          p_confirmed_overrides?: Json
          p_expected_loser_stage?: string
          p_expected_winner_stage?: string
          p_field_fill?: Json
          p_loser_id: string
          p_merge_key: string
          p_resolved_by?: string
          p_review_id?: string
          p_run_id?: string
          p_winner_id: string
        }
        Returns: Json
      }
      execute_project_status_action_as_system: {
        Args: { p_action_id: string; p_actor_user_id: string }
        Returns: Json
      }
      expense_envelope_period: {
        Args: { p_expense_date: string; p_review_frequency: string }
        Returns: {
          period_end: string
          period_start: string
        }[]
      }
      expense_envelope_sweep: { Args: never; Returns: number }
      fire_due_task_reminders: { Args: never; Returns: number }
      generate_product_sku: {
        Args: { p_category: string; p_company_id: string; p_kind: string }
        Returns: string
      }
      generate_text_id: { Args: never; Returns: string }
      get_company_join_details: { Args: { p_code: string }; Returns: Json }
      get_conversion_preflight: {
        Args: { p_company_id?: string; p_opportunity_id: string }
        Returns: Json
      }
      get_email_cron_status: {
        Args: never
        Returns: {
          active: boolean
          jobname: string
          schedule: string
        }[]
      }
      get_opportunity_lead_files: {
        Args: { p_opportunity_id: string }
        Returns: {
          created_at: string
          filename: string | null
          from_email: string | null
          id: string
          ingest_status: string
          mime_type: string | null
          occurred_at: string | null
          source_url: string | null
        }[]
      }
      get_inbox_density_per_client: {
        Args: { p_company_id: string }
        Returns: {
          client_id: string
          last_message_at: string
          thread_count: number
        }[]
      }
      get_next_document_number: {
        Args: { p_company_id: string; p_type: string }
        Returns: string
      }
      get_next_expense_batch_number: {
        Args: { p_company_id: string }
        Returns: string
      }
      get_or_create_open_batch: {
        Args: {
          p_company_id: string
          p_period_end: string
          p_period_start: string
          p_scope_project_id?: string
          p_submitted_by: string
        }
        Returns: {
          amendment_number: number
          approved_amount: number | null
          batch_number: string
          company_id: string
          created_at: string | null
          id: string
          parent_batch_id: string | null
          period_end: string | null
          period_start: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scope_project_id: string | null
          status: string
          submitted_by: string | null
          total_amount: number | null
        }
        SetofOptions: {
          from: "*"
          to: "expense_batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_photo_annotations_since: {
        Args: { p_since?: string }
        Returns: {
          annotation_url: string | null
          author_id: string
          company_id: string
          created_at: string
          deleted_at: string | null
          dimensions: Json | null
          id: string
          note: string | null
          photo_url: string
          project_id: string
          rendered_photo_url: string | null
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "project_photo_annotations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_user_company_id: { Args: never; Returns: string }
      get_user_id: { Args: never; Returns: string }
      has_permission: {
        Args: {
          p_permission: string
          p_required_scope?: string
          p_user_id: string
        }
        Returns: boolean
      }
      increment_access_count: {
        Args: { memory_ids: string[] }
        Returns: undefined
      }
      increment_audience_template_usage: {
        Args: { p_template_id: string }
        Returns: undefined
      }
      increment_campaign_counter: {
        Args: { p_campaign_id: string; p_delta?: number; p_field: string }
        Returns: undefined
      }
      increment_opportunity_correspondence: {
        Args: {
          p_email_date: string
          p_is_inbound: boolean
          p_opportunity_id: string
        }
        Returns: {
          correspondence_count: number
          inbound_count: number
          last_inbound_at: string
          last_outbound_at: string
          outbound_count: number
          stage: string
          stage_manually_set: boolean
        }[]
      }
      apply_opportunity_correspondence_event: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_opportunity_id: string
          p_provider_message_id: string
        }
        Returns: {
          assignment_version: number
          correspondence_count: number
          inbound_count: number
          last_inbound_at: string
          last_message_direction: string
          last_outbound_at: string
          outbound_count: number
          stage: string
          stage_manually_set: boolean
        }[]
      }
      record_opportunity_correspondence_event: {
        Args: {
          p_activity_id: string
          p_apply_opportunity_projection: boolean
          p_cc_emails: string[]
          p_company_id: string
          p_connection_id: string
          p_direction: string
          p_from_email: string
          p_is_meaningful: boolean
          p_linked_contact_id: string
          p_linked_contact_kind: string
          p_noise_reason: string
          p_occurred_at: string
          p_opportunity_id: string
          p_party_role: string
          p_provider_message_id: string
          p_provider_thread_id: string
          p_source: string
          p_subject: string
          p_to_emails: string[]
        }
        Returns: {
          assignment_version: number
          correspondence_count: number
          created: boolean
          event_id: string
          inbound_count: number
          last_inbound_at: string
          last_message_direction: string
          last_outbound_at: string
          outbound_count: number
          stage: string
          stage_manually_set: boolean
        }[]
      }
      apply_email_opportunity_stage_transition: {
        Args: {
          p_ai_signal?: string
          p_company_id: string
          p_expected_assignment_version: number
          p_expected_stage: string
          p_opportunity_id: string
          p_to_stage: string
        }
        Returns: {
          changed: boolean
          guard_reason: string | null
          stage: string
          stage_manually_set: boolean
        }[]
      }
      apply_email_opportunity_deferred_disposition: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_evidence?: Json
          p_expected_assignment_version: number
          p_expected_stage: string
          p_next_follow_up_at: string
          p_opportunity_id: string
          p_provider_message_id: string
        }
        Returns: {
          changed: boolean
          disposition_id: string | null
          guard_reason: string | null
          next_follow_up_at: string | null
          stage: string
        }[]
      }
      increment_signup_count: {
        Args: { variant_id: string }
        Returns: undefined
      }
      increment_visitor_count: {
        Args: { variant_id: string }
        Returns: undefined
      }
      initialize_company_defaults: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      is_company_admin: { Args: never; Returns: boolean }
      join_user_to_company: {
        Args: {
          p_company_code?: string
          p_company_id: string
          p_user_id: string
        }
        Returns: Json
      }
      lookup_company_by_code: {
        Args: { lookup_code: string }
        Returns: {
          account_holder_id: string | null
          address: string | null
          admin_ids: string[] | null
          ai_enabled: boolean
          bubble_id: string | null
          client_comms_settings: Json | null
          close_hour: string | null
          company_age: string | null
          company_code: string | null
          company_size: string | null
          created_at: string | null
          currency_code: string
          data_setup_completed: boolean | null
          data_setup_purchased: boolean | null
          data_setup_scheduled: string | null
          default_project_color: string | null
          default_work_end: string
          default_work_start: string
          deleted_at: string | null
          description: string | null
          email: string | null
          external_id: string | null
          has_priority_support: boolean | null
          id: string
          industries: string[] | null
          industry: string | null
          latitude: number | null
          locale: string
          logo_url: string | null
          longitude: number | null
          max_seats: number | null
          name: string
          open_hour: string | null
          phone: string | null
          physical_address: string | null
          precise_scheduling_enabled: boolean | null
          priority_support_period: string | null
          referral_method: string | null
          seat_grace_start_date: string | null
          seated_employee_ids: string[] | null
          skip_weekends_in_auto_schedule: boolean | null
          source_app: string
          stripe_customer_id: string | null
          subscription_end: string | null
          subscription_ids_json: string | null
          subscription_period: string | null
          subscription_plan: string | null
          subscription_status: string | null
          timezone: string
          trial_end_date: string | null
          trial_start_date: string | null
          updated_at: string | null
          weather_dependent: boolean | null
          website: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "companies"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      match_memories: {
        Args: {
          match_company_id: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          access_count: number
          category: string
          confidence: number
          content: string
          decay_score: number
          entity_id: string
          id: string
          memory_type: string
          similarity: number
          source: string
        }[]
      }
      mark_email_attachment_connection_needs_reconnect: {
        Args: { p_company_id: string; p_connection_id: string }
        Returns: number
      }
      mark_email_connection_needs_reconnect_as_system: {
        Args: { p_connection_id: string }
        Returns: number
      }
      mirror_deck_subscription: {
        Args: { p_row: Json }
        Returns: boolean
      }
      move_opportunity_stage: {
        Args: {
          p_opportunity_id: string
          p_to_stage: string
          p_user_id: string
        }
        Returns: {
          actual_close_date: string | null
          actual_value: number | null
          address: string | null
          ai_stage_confidence: number | null
          ai_stage_signals: string[] | null
          ai_summary: string | null
          ai_summary_updated_at: string | null
          archived_at: string | null
          assigned_to: string | null
          client_id: string | null
          client_ref: string | null
          company_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          correspondence_count: number
          created_at: string
          deleted_at: string | null
          description: string | null
          detected_value: number | null
          estimated_value: number | null
          expected_close_date: string | null
          id: string
          images: string[] | null
          inbound_count: number
          last_activity_at: string | null
          last_inbound_at: string | null
          last_message_direction: string | null
          last_outbound_at: string | null
          handled_at: string | null
          latitude: number | null
          longitude: number | null
          lost_notes: string | null
          lost_reason: string | null
          merged_into_opportunity_id: string | null
          next_follow_up_at: string | null
          outbound_count: number
          priority: string | null
          project_id: string | null
          project_ref: string | null
          quote_delivery_method: string | null
          source: string | null
          source_email_id: string | null
          source_message_id: string | null
          source_metadata: Json | null
          stage: string
          stage_entered_at: string
          stage_manually_set: boolean
          tags: string[] | null
          title: string
          updated_at: string
          win_probability: number | null
        }
        SetofOptions: {
          from: "*"
          to: "opportunities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      notify_email_attachment_scan_exception: {
        Args: {
          p_action_label: string
          p_action_url: string
          p_body: string
          p_company_id: string
          p_scan_id: string
          p_title: string
          p_user_id: string
        }
        Returns: boolean
      }
      notify_email_attachment_scan_exception_as_system: {
        Args: { p_scan_id: string }
        Returns: boolean
      }
      place_expense: { Args: { p_expense_id: string }; Returns: undefined }
      pmf_count_retained_saas: { Args: never; Returns: number }
      pmf_count_tier_a_paid_delivered: { Args: never; Returns: number }
      pmf_is_admin: { Args: { user_email: string }; Returns: boolean }
      pmf_latest_cohort_churn: { Args: never; Returns: number }
      pmf_latest_mature_conversion: { Args: never; Returns: number }
      pmf_mrr_weekly: {
        Args: { weeks?: number }
        Returns: {
          mrr_cents: number
          week: string
        }[]
      }
      pmf_retention_cohorts: {
        Args: never
        Returns: {
          cohort_month: string
          d30: number
          d60: number
          d90: number
          size: number
        }[]
      }
      pmf_sparkline: { Args: { kind: string }; Returns: number[] }
      prepare_email_outbound_learning: {
        Args: {
          p_apply_full_body_learning: boolean
          p_apply_learning: boolean
          p_draft_correction_facts: Json
          p_draft_outcome: Json
          p_job_id: string
          p_lease_token: string
          p_memory_extraction: Json
          p_preparation_version: string
          p_writing_sample: Json
        }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      persist_task_automation_agent_action: {
        Args: {
          p_action_data: Json
          p_action_type: string
          p_auto_execute_at?: string
          p_confidence?: number
          p_context_source: string
          p_context_summary: string
          p_event_id: string
          p_expires_at?: string
          p_lease_token: string
          p_priority?: string
          p_source_id: string
          p_task_id: string
          p_task_schedule_version: number
        }
        Returns: Json
      }
      persist_task_automation_notification: {
        Args: {
          p_action_label?: string
          p_action_url?: string
          p_body: string
          p_event_id: string
          p_lease_token: string
          p_task_id: string
          p_task_schedule_version: number
          p_title: string
        }
        Returns: Json
      }
      persist_task_mutation_notification_as_system: {
        Args: { p_event_id: string; p_lease_token: string }
        Returns: Json
      }
      process_email_signature_notification_lifecycle: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
        }
        Returns: boolean
      }
      products_import_apply: {
        Args: { p_company_id: string; p_payload: Json }
        Returns: Json
      }
      products_import_validate: {
        Args: { p_company_id: string; p_payload: Json }
        Returns: Json
      }
      promote_email_outbound_edit_learning: {
        Args: { p_job_id: string }
        Returns: Json
      }
      project_pipeline_summary: {
        Args: { p_project_id: string }
        Returns: {
          change_orders_count: number
          days_aged: number
          deposit_pct: number
          invoiced_record_id: string
          invoiced_total: number
          outstanding_due_date: string
          outstanding_total: number
          quoted_record_id: string
          quoted_total: number
          received_record_id: string
          received_total: number
        }[]
      }
      provision_deck_company: {
        Args: {
          p_firebase_uid: string
          p_company_name: string
          p_email?: string
        }
        Returns: Json
      }
      qbo_match_customer_candidates: {
        Args: { p_company_id: string; p_name: string; p_threshold?: number }
        Returns: {
          client_id: string
          email: string
          name: string
          phone_number: string
          similarity: number
        }[]
      }
      recalculate_expense_batch_total: {
        Args: { p_batch_id: string }
        Returns: number
      }
      reconcile_operator_template_follow_up_send_as_system: {
        Args: { p_intent_id: string }
        Returns: {
          applied_at: string
          comeback_at: string | null
          intent_id: string
          notification_id: string
          opportunity_id: string
        }[]
      }
      record_auto_bug:
        | {
            Args: {
              p_app_version: string
              p_build_number: string
              p_category: string
              p_device_model: string
              p_error_code: string
              p_metadata: Json
              p_network_type: string
              p_os_version: string
              p_priority: string
              p_screen: string
              p_summary: string
              p_suspected_file: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_app_version: string
              p_build_number: string
              p_category: string
              p_device_model: string
              p_error_code: string
              p_fire_count?: number
              p_metadata: Json
              p_network_type: string
              p_os_version: string
              p_priority: string
              p_screen: string
              p_summary: string
              p_suspected_file: string
            }
            Returns: Json
          }
      refresh_email_activity_attachments: {
        Args: { p_activity_id: string }
        Returns: undefined
      }
      refresh_spec_board_snapshot: { Args: never; Returns: undefined }
      release_phase_c_lock: {
        Args: { p_holder: string; p_job_id: string }
        Returns: undefined
      }
      remove_project_team_member: {
        Args: {
          p_expected_updated_at?: string
          p_project_id: string
          p_task_ids?: string[]
          p_user_id: string
        }
        Returns: Json
      }
      remove_seated_employee: {
        Args: { p_company_id: string; p_user_id: string }
        Returns: undefined
      }
      rename_opportunity_table_view: {
        Args: { p_name: string; p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "opportunity_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rename_project_table_view: {
        Args: { p_name: string; p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "project_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reparent_opportunity_email_message_guarded: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
          p_entry_sha256: string
          p_expected_activity_id: string
          p_expected_correspondence_event_id: string
          p_expected_source_assigned_to: string | null
          p_expected_source_assignment_version: number
          p_expected_source_project_id: string | null
          p_expected_source_stage: string
          p_expected_source_stage_manually_set: boolean
          p_expected_source_updated_at: string
          p_expected_target_assigned_to: string | null
          p_expected_target_assignment_version: number
          p_expected_target_project_id: string | null
          p_expected_target_stage: string
          p_expected_target_stage_manually_set: boolean
          p_expected_target_updated_at: string
          p_manifest_sha256: string
          p_provider_message_id: string
          p_provider_thread_id: string
          p_source_opportunity_id: string
          p_target_email: string
          p_target_opportunity_id: string
        }
        Returns: Json
      }
      reassign_opportunity_email_thread_guarded: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
          p_kind?: string
          p_provider_thread_id: string
          p_target_opportunity_id: string
        }
        Returns: Json
      }
      quarantine_opportunity_email_thread_guarded: {
        Args: {
          p_actor_user_id: string
          p_company_id: string
          p_connection_id: string
          p_kind?: string
          p_provider_thread_id: string
        }
        Returns: Json
      }
      reassign_phase_c_mailbox_draft: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_expected_old_draft_history_id?: string | null
          p_mailbox_draft_id: string
          p_new_draft_history_id: string
          p_subject?: string | null
          p_thread_id: string
        }
        Returns: Json
      }
      requeue_failed_email_outbound_learning: {
        Args: { p_job_id: string; p_reason: string }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_email_signature: {
        Args: {
          p_actor_user_id: string | null
          p_company_id: string
          p_confirmed_at: string | null
          p_connection_id: string
          p_content_hash: string
          p_content_html: string | null
          p_content_text: string | null
          p_fetched_at: string | null
          p_provider_identity: string | null
          p_scope_user_id: string | null
          p_source: string
        }
        Returns: Database["public"]["Tables"]["email_signatures"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_signatures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      replace_email_signature_as_system: {
        Args: {
          p_actor_user_id: string
          p_confirmed_at: string | null
          p_connection_id: string
          p_content_hash: string
          p_content_html: string | null
          p_content_text: string | null
          p_fetched_at: string | null
          p_provider_identity: string | null
          p_source: string
        }
        Returns: Database["public"]["Tables"]["email_signatures"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_signatures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      deactivate_email_signature_as_system: {
        Args: {
          p_actor_user_id: string
          p_connection_id: string
          p_signature_id?: string | null
          p_source?: string | null
        }
        Returns: number
      }
      reset_opportunity_table_view: {
        Args: { p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "opportunity_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reset_project_table_view: {
        Args: { p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "project_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_lockout_admin_notification: {
        Args: never
        Returns: number
      }
      resolve_openai_quota_notification_as_system: {
        Args: {
          p_notification_id: string
          p_user_id: string
          p_company_id: string
          p_dedupe_key: string
          p_expected_incident_version: number
        }
        Returns: boolean
      }
      resolve_project_status_notification_as_system: {
        Args: {
          p_actor_user_id: string
          p_event_id: string
          p_project_id: string
        }
        Returns: Json
      }
      resolve_product_price: {
        Args: { p_client_id: string; p_product_id: string }
        Returns: number
      }
      resolve_task_reminder_recipients: {
        Args: {
          p_company_id: string
          p_recipient_config: Json
          p_recipient_mode: string
          p_task_team_members: string[]
        }
        Returns: string[]
      }
      retry_email_outbound_learning: {
        Args: { p_error: string; p_job_id: string; p_lease_token: string }
        Returns: Database["public"]["Tables"]["email_outbound_learning_queue"]["Row"]
        SetofOptions: {
          from: "*"
          to: "email_outbound_learning_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_company_inventory_mode: {
        Args: { p_company_id: string; p_inventory_mode: string }
        Returns: Json
      }
      share_opportunity_table_view: {
        Args: { p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "opportunity_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      share_project_table_view: {
        Args: { p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "project_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_feature_request: {
        Args: {
          p_app_version?: string
          p_company_id: string
          p_description: string
          p_platform?: string
          p_title: string
          p_type: string
          p_user_email?: string
          p_user_id: string
          p_user_name?: string
        }
        Returns: undefined
      }
      sync_email_signature_notification: {
        Args: {
          p_company_id: string
          p_connection_id: string
          p_scope_user_id: string
        }
        Returns: Database["public"]["Tables"]["notifications"]["Row"]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sync_email_signature_notification_as_system: {
        Args: {
          p_actor_user_id: string
          p_connection_id: string
        }
        Returns: Database["public"]["Tables"]["notifications"]["Row"]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      terminalize_expired_project_status_lifecycle_events: {
        Args: never
        Returns: number
      }
      template_version_compare: {
        Args: {
          p_email_type: string
          p_since?: string
          p_version_a: string
          p_version_b: string
        }
        Returns: Json
      }
      toggle_email_cron: {
        Args: { p_active: boolean; p_jobname: string }
        Returns: {
          active: boolean
          jobname: string
        }[]
      }
      update_opportunity_table_view_definition: {
        Args: { p_definition: Json; p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "opportunity_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_project_table_view_definition: {
        Args: { p_definition: Json; p_view_id: string }
        Returns: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          density: string
          description: string | null
          filters: Json
          icon: string | null
          id: string
          is_archived: boolean
          is_default: boolean
          name: string
          owner_id: string
          owner_type: string
          permission_key: string | null
          sort: Json
          sort_position: number
          updated_at: string
          zoom_level: number
        }
        SetofOptions: {
          from: "*"
          to: "project_views"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_task_with_event: {
        Args: {
          p_expected_updated_at: string | null
          p_patch: Json
          p_task_id: string
        }
        Returns: Json
      }
      update_task_with_event_as_system: {
        Args: {
          p_actor_user_id: string
          p_expected_updated_at: string | null
          p_patch: Json
          p_task_id: string
        }
        Returns: Json
      }
      users_with_permission: {
        Args: {
          p_company_id: string
          p_permission: string
          p_required_scope?: string
        }
        Returns: string[]
      }
    }
    Enums: {
      assessment_type: "quiz" | "assignment" | "test"
      bundle_type: "fixed" | "pick_n"
      content_block_type:
        | "video"
        | "text"
        | "download"
        | "quiz"
        | "action_item"
        | "image"
        | "embed"
        | "assignment"
        | "interactive_tool"
      course_status: "draft" | "published" | "archived"
      email_anomaly_kind:
        | "bounce_spike"
        | "spam_spike"
        | "delivery_drop"
        | "volume_drop"
      email_anomaly_severity: "warn" | "critical"
      email_campaign_status:
        | "draft"
        | "scheduled"
        | "in_flight"
        | "completed"
        | "failed"
        | "cancelled"
        | "paused"
      email_job_status:
        | "pending"
        | "dispatching"
        | "sent"
        | "bounced"
        | "failed"
        | "cancelled"
        | "skipped_suppressed"
      enrollment_status: "active" | "completed" | "expired" | "purchased"
      gmail_connection_type: "company" | "individual"
      lesson_progress_status: "not_started" | "in_progress" | "completed"
      onboarding_email_status: "pending" | "sent" | "failed" | "skipped"
      photo_source:
        | "site_visit"
        | "in_progress"
        | "completion"
        | "other"
        | "measurement"
        | "deck_design"
      quiz_question_type: "multiple_choice" | "scenario" | "true_false"
      site_visit_status: "scheduled" | "in_progress" | "completed" | "cancelled"
      spec_change_order_status:
        | "proposed"
        | "customer_approved"
        | "customer_declined"
        | "in_progress"
        | "completed"
        | "paid"
      spec_change_order_type:
        | "minor_hourly"
        | "major_fixed"
        | "polish_budget"
        | "platform_compat_rebuild"
        | "tier_upgrade"
      spec_feature_status: "pending" | "passing" | "failing"
      spec_hold_type: "customer_requested" | "ops_blocked"
      spec_owner_approval_status:
        | "pending"
        | "approved"
        | "declined"
        | "expired"
      spec_payment_milestone:
        | "deposit"
        | "scope_signoff"
        | "midpoint"
        | "delivery"
      spec_payment_status:
        | "pending"
        | "invoiced"
        | "paid"
        | "overdue"
        | "disputed"
        | "refunded"
        | "partially_refunded"
        | "voided"
        | "uncollectible"
      spec_project_status:
        | "awaiting_owner_approval"
        | "awaiting_deposit"
        | "deposit_paid"
        | "discovery"
        | "building"
        | "on_hold"
        | "stalled_on_hold"
        | "support"
        | "on_retainer"
        | "completed"
        | "stalled"
        | "cancelled"
        | "refunded"
      spec_referral_status:
        | "pending"
        | "eligible"
        | "kyc_required"
        | "review"
        | "paid"
        | "forfeited"
        | "held"
      spec_refund_source: "customer_initiated" | "stripe_dispute"
      spec_refund_status:
        | "pending"
        | "processed"
        | "partial"
        | "failed"
        | "denied"
      spec_retainer_status: "active" | "paused" | "cancelled"
      spec_ticket_phase: "support" | "retainer" | "ad_hoc"
      spec_ticket_severity: "critical" | "high" | "cosmetic_enhancement"
      spec_ticket_status:
        | "open"
        | "in_progress"
        | "resolved"
        | "escalated_to_change_order"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      assessment_type: ["quiz", "assignment", "test"],
      bundle_type: ["fixed", "pick_n"],
      content_block_type: [
        "video",
        "text",
        "download",
        "quiz",
        "action_item",
        "image",
        "embed",
        "assignment",
        "interactive_tool",
      ],
      course_status: ["draft", "published", "archived"],
      email_anomaly_kind: [
        "bounce_spike",
        "spam_spike",
        "delivery_drop",
        "volume_drop",
      ],
      email_anomaly_severity: ["warn", "critical"],
      email_campaign_status: [
        "draft",
        "scheduled",
        "in_flight",
        "completed",
        "failed",
        "cancelled",
        "paused",
      ],
      email_job_status: [
        "pending",
        "dispatching",
        "sent",
        "bounced",
        "failed",
        "cancelled",
        "skipped_suppressed",
      ],
      enrollment_status: ["active", "completed", "expired", "purchased"],
      gmail_connection_type: ["company", "individual"],
      lesson_progress_status: ["not_started", "in_progress", "completed"],
      onboarding_email_status: ["pending", "sent", "failed", "skipped"],
      photo_source: [
        "site_visit",
        "in_progress",
        "completion",
        "other",
        "measurement",
        "deck_design",
      ],
      quiz_question_type: ["multiple_choice", "scenario", "true_false"],
      site_visit_status: ["scheduled", "in_progress", "completed", "cancelled"],
      spec_change_order_status: [
        "proposed",
        "customer_approved",
        "customer_declined",
        "in_progress",
        "completed",
        "paid",
      ],
      spec_change_order_type: [
        "minor_hourly",
        "major_fixed",
        "polish_budget",
        "platform_compat_rebuild",
        "tier_upgrade",
      ],
      spec_feature_status: ["pending", "passing", "failing"],
      spec_hold_type: ["customer_requested", "ops_blocked"],
      spec_owner_approval_status: [
        "pending",
        "approved",
        "declined",
        "expired",
      ],
      spec_payment_milestone: [
        "deposit",
        "scope_signoff",
        "midpoint",
        "delivery",
      ],
      spec_payment_status: [
        "pending",
        "invoiced",
        "paid",
        "overdue",
        "disputed",
        "refunded",
        "partially_refunded",
        "voided",
        "uncollectible",
      ],
      spec_project_status: [
        "awaiting_owner_approval",
        "awaiting_deposit",
        "deposit_paid",
        "discovery",
        "building",
        "on_hold",
        "stalled_on_hold",
        "support",
        "on_retainer",
        "completed",
        "stalled",
        "cancelled",
        "refunded",
      ],
      spec_referral_status: [
        "pending",
        "eligible",
        "kyc_required",
        "review",
        "paid",
        "forfeited",
        "held",
      ],
      spec_refund_source: ["customer_initiated", "stripe_dispute"],
      spec_refund_status: [
        "pending",
        "processed",
        "partial",
        "failed",
        "denied",
      ],
      spec_retainer_status: ["active", "paused", "cancelled"],
      spec_ticket_phase: ["support", "retainer", "ad_hoc"],
      spec_ticket_severity: ["critical", "high", "cosmetic_enhancement"],
      spec_ticket_status: [
        "open",
        "in_progress",
        "resolved",
        "escalated_to_change_order",
      ],
    },
  },
} as const
