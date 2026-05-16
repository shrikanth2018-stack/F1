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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notes: {
        Row: {
          branch_id: number | null
          created_at: string | null
          created_by: string | null
          id: number
          is_active: boolean | null
          note_text: string
          target_tab: string | null
          updated_at: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: number
          is_active?: boolean | null
          note_text: string
          target_tab?: string | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: number
          is_active?: boolean | null
          note_text?: string
          target_tab?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_notes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      app_feedback: {
        Row: {
          comments: string | null
          created_at: string | null
          id: number
          order_id: number | null
          rating: number | null
          user_id: string | null
        }
        Insert: {
          comments?: string | null
          created_at?: string | null
          id?: number
          order_id?: number | null
          rating?: number | null
          user_id?: string | null
        }
        Update: {
          comments?: string | null
          created_at?: string | null
          id?: number
          order_id?: number | null
          rating?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_feedback_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          id: number
          landing_hero_url: string | null
          login_bg_url: string
          staff_benefits: Json | null
          staff_designations: Json | null
          updated_at: string
        }
        Insert: {
          id?: number
          landing_hero_url?: string | null
          login_bg_url?: string
          staff_benefits?: Json | null
          staff_designations?: Json | null
          updated_at?: string
        }
        Update: {
          id?: number
          landing_hero_url?: string | null
          login_bg_url?: string
          staff_benefits?: Json | null
          staff_designations?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      banners: {
        Row: {
          banner_type: string | null
          branch_id: number | null
          created_at: string | null
          id: number
          image_url: string | null
          is_live: boolean | null
          text_content: string | null
          updated_at: string | null
        }
        Insert: {
          banner_type?: string | null
          branch_id?: number | null
          created_at?: string | null
          id?: number
          image_url?: string | null
          is_live?: boolean | null
          text_content?: string | null
          updated_at?: string | null
        }
        Update: {
          banner_type?: string | null
          branch_id?: number | null
          created_at?: string | null
          id?: number
          image_url?: string | null
          is_live?: boolean | null
          text_content?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "banners_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          branch_name: string
          created_at: string | null
          id: number
          is_active: boolean | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          branch_name: string
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          branch_name?: string
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      business_expenses: {
        Row: {
          amount: number
          branch_id: number | null
          category: string
          created_at: string | null
          description: string
          expense_date: string
          id: number
          is_paid: boolean | null
          paid_at: string | null
          recorded_by: string | null
          vendor: string | null
        }
        Insert: {
          amount: number
          branch_id?: number | null
          category: string
          created_at?: string | null
          description: string
          expense_date: string
          id?: number
          is_paid?: boolean | null
          paid_at?: string | null
          recorded_by?: string | null
          vendor?: string | null
        }
        Update: {
          amount?: number
          branch_id?: number | null
          category?: string
          created_at?: string | null
          description?: string
          expense_date?: string
          id?: number
          is_paid?: boolean | null
          paid_at?: string | null
          recorded_by?: string | null
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_expenses_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cancelled_subscription_days: {
        Row: {
          branch_id: number | null
          cancelled_date: string
          created_at: string | null
          cycle_id: number | null
          id: number
          reason: string | null
          subscription_id: number | null
        }
        Insert: {
          branch_id?: number | null
          cancelled_date: string
          created_at?: string | null
          cycle_id?: number | null
          id?: number
          reason?: string | null
          subscription_id?: number | null
        }
        Update: {
          branch_id?: number | null
          cancelled_date?: string
          created_at?: string | null
          cycle_id?: number | null
          id?: number
          reason?: string | null
          subscription_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cancelled_subscription_days_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancelled_subscription_days_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "delivery_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancelled_subscription_days_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "user_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_addresses: {
        Row: {
          address_line: string
          branch_id: number | null
          city: string | null
          created_at: string | null
          full_name: string
          hub_id: number | null
          hub_impact_notified_at: string | null
          id: number
          is_active: boolean | null
          is_default: boolean | null
          is_serviceable: boolean
          label: string | null
          landmark: string | null
          latitude: number | null
          longitude: number | null
          phone_number: string | null
          pincode: string | null
          updated_at: string | null
          user_id: string | null
          zone_id: number | null
        }
        Insert: {
          address_line: string
          branch_id?: number | null
          city?: string | null
          created_at?: string | null
          full_name: string
          hub_id?: number | null
          hub_impact_notified_at?: string | null
          id?: number
          is_active?: boolean | null
          is_default?: boolean | null
          is_serviceable?: boolean
          label?: string | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          phone_number?: string | null
          pincode?: string | null
          updated_at?: string | null
          user_id?: string | null
          zone_id?: number | null
        }
        Update: {
          address_line?: string
          branch_id?: number | null
          city?: string | null
          created_at?: string | null
          full_name?: string
          hub_id?: number | null
          hub_impact_notified_at?: string | null
          id?: number
          is_active?: boolean | null
          is_default?: boolean | null
          is_serviceable?: boolean
          label?: string | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          phone_number?: string | null
          pincode?: string | null
          updated_at?: string | null
          user_id?: string | null
          zone_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_addresses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "delivery_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_addresses_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "delivery_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_cycles: {
        Row: {
          branch_id: number | null
          created_at: string | null
          cutoff_time: string
          cycle_name: string
          delivery_start: string
          essentials_label: string | null
          id: number
          is_active: boolean | null
          is_essentials: boolean | null
          kitchen_push_time: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          cutoff_time: string
          cycle_name: string
          delivery_start: string
          essentials_label?: string | null
          id?: number
          is_active?: boolean | null
          is_essentials?: boolean | null
          kitchen_push_time: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          cutoff_time?: string
          cycle_name?: string
          delivery_start?: string
          essentials_label?: string | null
          id?: number
          is_active?: boolean | null
          is_essentials?: boolean | null
          kitchen_push_time?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_cycles_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_hubs: {
        Row: {
          address_details: string
          branch_id: number | null
          center_lat: number | null
          center_lng: number | null
          commission_percent: number | null
          contact_phone: string | null
          created_at: string | null
          delivery_fee_override: number | null
          driver_code: string | null
          driver_user_id: string | null
          extends_coverage: boolean
          hub_code: string | null
          hub_name: string
          id: number
          is_active: boolean | null
          polygon_geojson: Json | null
          staff_name: string | null
          staff_phone: string | null
          staff_user_id: string | null
          updated_at: string | null
        }
        Insert: {
          address_details: string
          branch_id?: number | null
          center_lat?: number | null
          center_lng?: number | null
          commission_percent?: number | null
          contact_phone?: string | null
          created_at?: string | null
          delivery_fee_override?: number | null
          driver_code?: string | null
          driver_user_id?: string | null
          extends_coverage?: boolean
          hub_code?: string | null
          hub_name: string
          id?: number
          is_active?: boolean | null
          polygon_geojson?: Json | null
          staff_name?: string | null
          staff_phone?: string | null
          staff_user_id?: string | null
          updated_at?: string | null
        }
        Update: {
          address_details?: string
          branch_id?: number | null
          center_lat?: number | null
          center_lng?: number | null
          commission_percent?: number | null
          contact_phone?: string | null
          created_at?: string | null
          delivery_fee_override?: number | null
          driver_code?: string | null
          driver_user_id?: string | null
          extends_coverage?: boolean
          hub_code?: string | null
          hub_name?: string
          id?: number
          is_active?: boolean | null
          polygon_geojson?: Json | null
          staff_name?: string | null
          staff_phone?: string | null
          staff_user_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_hubs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zones: {
        Row: {
          branch_id: number | null
          created_at: string | null
          delivery_fee_override: number | null
          description: string | null
          driver_code: string | null
          driver_user_id: string | null
          hub_id: number | null
          id: number
          is_active: boolean | null
          polygon_geojson: Json | null
          updated_at: string | null
          zone_name: string
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          delivery_fee_override?: number | null
          description?: string | null
          driver_code?: string | null
          driver_user_id?: string | null
          hub_id?: number | null
          id?: number
          is_active?: boolean | null
          polygon_geojson?: Json | null
          updated_at?: string | null
          zone_name: string
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          delivery_fee_override?: number | null
          description?: string | null
          driver_code?: string | null
          driver_user_id?: string | null
          hub_id?: number | null
          id?: number
          is_active?: boolean | null
          polygon_geojson?: Json | null
          updated_at?: string | null
          zone_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_zones_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "delivery_hubs"
            referencedColumns: ["id"]
          },
        ]
      }
      essentials_catalog: {
        Row: {
          branch_id: number | null
          created_at: string | null
          cycle_id: number | null
          id: number
          is_active: boolean | null
          name: string
          price: number
          sort_order: number | null
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          id?: number
          is_active?: boolean | null
          name: string
          price: number
          sort_order?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          id?: number
          is_active?: boolean | null
          name?: string
          price?: number
          sort_order?: number | null
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "essentials_catalog_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "essentials_catalog_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "delivery_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_claims: {
        Row: {
          amount: number | null
          approved_by: string | null
          branch_id: number | null
          category: string | null
          created_at: string | null
          description: string
          id: number
          paid_at: string | null
          staff_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          approved_by?: string | null
          branch_id?: number | null
          category?: string | null
          created_at?: string | null
          description: string
          id?: number
          paid_at?: string | null
          staff_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          approved_by?: string | null
          branch_id?: number | null
          category?: string | null
          created_at?: string | null
          description?: string
          id?: number
          paid_at?: string | null
          staff_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_claims_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claims_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_claims_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          flag_key: string
          flag_value: boolean | null
          id: number
          updated_at: string | null
        }
        Insert: {
          description?: string | null
          flag_key: string
          flag_value?: boolean | null
          id?: number
          updated_at?: string | null
        }
        Update: {
          description?: string | null
          flag_key?: string
          flag_value?: boolean | null
          id?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          created_at: string
          endpoint: string
          key: string
          response: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          key: string
          response?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          key?: string
          response?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_push_log: {
        Row: {
          cycle_id: number
          http_request_id: number | null
          id: number
          items_summary: string | null
          orders_count: number | null
          push_date: string
          pushed_at: string | null
        }
        Insert: {
          cycle_id: number
          http_request_id?: number | null
          id?: number
          items_summary?: string | null
          orders_count?: number | null
          push_date: string
          pushed_at?: string | null
        }
        Update: {
          cycle_id?: number
          http_request_id?: number | null
          id?: number
          items_summary?: string | null
          orders_count?: number | null
          push_date?: string
          pushed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_push_log_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "delivery_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_redemptions: {
        Row: {
          created_at: string | null
          description: string | null
          id: number
          points: number
          reference_order_id: number | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: number
          points: number
          reference_order_id?: number | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: number
          points?: number
          reference_order_id?: number | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_redemptions_reference_order_id_fkey"
            columns: ["reference_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      manifest_run_log: {
        Row: {
          error_detail: string | null
          id: number
          orders_created: number | null
          orders_skipped: number | null
          ran_at: string | null
          run_date: string
          subs_skipped: number | null
        }
        Insert: {
          error_detail?: string | null
          id?: number
          orders_created?: number | null
          orders_skipped?: number | null
          ran_at?: string | null
          run_date: string
          subs_skipped?: number | null
        }
        Update: {
          error_detail?: string | null
          id?: number
          orders_created?: number | null
          orders_skipped?: number | null
          ran_at?: string | null
          run_date?: string
          subs_skipped?: number | null
        }
        Relationships: []
      }
      menu_items: {
        Row: {
          branch_id: number | null
          created_at: string | null
          cycle_id: number | null
          id: number
          ingredients: string | null
          is_active: boolean | null
          name: string
          price: number
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          id?: number
          ingredients?: string | null
          is_active?: boolean | null
          name: string
          price: number
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          id?: number
          ingredients?: string | null
          is_active?: boolean | null
          name?: string
          price?: number
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "delivery_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body_template: string
          description: string | null
          event_key: string
          is_enabled: boolean
          title_template: string
          trigger_source: string | null
          updated_at: string
        }
        Insert: {
          body_template: string
          description?: string | null
          event_key: string
          is_enabled?: boolean
          title_template: string
          trigger_source?: string | null
          updated_at?: string
        }
        Update: {
          body_template?: string
          description?: string | null
          event_key?: string
          is_enabled?: boolean
          title_template?: string
          trigger_source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      order_item_ratings: {
        Row: {
          comments: string | null
          created_at: string
          id: number
          order_id: number
          order_item_id: number
          rating: number
          user_id: string
        }
        Insert: {
          comments?: string | null
          created_at?: string
          id?: number
          order_id: number
          order_item_id: number
          rating: number
          user_id: string
        }
        Update: {
          comments?: string | null
          created_at?: string
          id?: number
          order_id?: number
          order_item_id?: number
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_item_ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_ratings_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: number
          item_id: number | null
          item_name: string
          item_type: string | null
          order_id: number | null
          price_at_time: number
          quantity: number
        }
        Insert: {
          id?: number
          item_id?: number | null
          item_name: string
          item_type?: string | null
          order_id?: number | null
          price_at_time: number
          quantity: number
        }
        Update: {
          id?: number
          item_id?: number | null
          item_name?: string
          item_type?: string | null
          order_id?: number | null
          price_at_time?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          branch_id: number | null
          created_at: string | null
          cycle_id: number | null
          delivery_address_id: number | null
          delivery_fee: number | null
          delivery_method: string | null
          dispatch_date: string
          hub_id: number | null
          id: number
          notes: string | null
          order_group_id: string
          order_type: string | null
          paid_at: string | null
          payment_method: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          status: string | null
          subscription_id: number | null
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
          user_id: string | null
          wallet_amount_used: number | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          delivery_address_id?: number | null
          delivery_fee?: number | null
          delivery_method?: string | null
          dispatch_date: string
          hub_id?: number | null
          id?: number
          notes?: string | null
          order_group_id?: string
          order_type?: string | null
          paid_at?: string | null
          payment_method?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string | null
          subscription_id?: number | null
          tax_amount?: number | null
          total_amount: number
          updated_at?: string | null
          user_id?: string | null
          wallet_amount_used?: number | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          delivery_address_id?: number | null
          delivery_fee?: number | null
          delivery_method?: string | null
          dispatch_date?: string
          hub_id?: number | null
          id?: number
          notes?: string | null
          order_group_id?: string
          order_type?: string | null
          paid_at?: string | null
          payment_method?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string | null
          subscription_id?: number | null
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          user_id?: string | null
          wallet_amount_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "delivery_cycles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_delivery_address_id_fkey"
            columns: ["delivery_address_id"]
            isOneToOne: false
            referencedRelation: "customer_addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_hub_id_fkey"
            columns: ["hub_id"]
            isOneToOne: false
            referencedRelation: "delivery_hubs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "user_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_wallet_topups: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string
          razorpay_order_id: string
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string
          razorpay_order_id: string
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string
          razorpay_order_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_wallet_topups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          assigned_hub_id: number | null
          benefits: string | null
          branch_id: number | null
          created_at: string | null
          designation: string | null
          employee_id: string | null
          exit_date: string | null
          full_name: string | null
          id: string
          is_super_admin: boolean
          joining_date: string | null
          loyalty_points: number | null
          monthly_salary: number | null
          phone_number: string
          referral_code: string | null
          referred_by: string | null
          role: string | null
          shift_timing: string | null
          updated_at: string | null
          wallet_balance: number | null
        }
        Insert: {
          assigned_hub_id?: number | null
          benefits?: string | null
          branch_id?: number | null
          created_at?: string | null
          designation?: string | null
          employee_id?: string | null
          exit_date?: string | null
          full_name?: string | null
          id: string
          is_super_admin?: boolean
          joining_date?: string | null
          loyalty_points?: number | null
          monthly_salary?: number | null
          phone_number: string
          referral_code?: string | null
          referred_by?: string | null
          role?: string | null
          shift_timing?: string | null
          updated_at?: string | null
          wallet_balance?: number | null
        }
        Update: {
          assigned_hub_id?: number | null
          benefits?: string | null
          branch_id?: number | null
          created_at?: string | null
          designation?: string | null
          employee_id?: string | null
          exit_date?: string | null
          full_name?: string | null
          id?: string
          is_super_admin?: boolean
          joining_date?: string | null
          loyalty_points?: number | null
          monthly_salary?: number | null
          phone_number?: string
          referral_code?: string | null
          referred_by?: string | null
          role?: string | null
          shift_timing?: string | null
          updated_at?: string | null
          wallet_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_logs: {
        Row: {
          body: string
          data: Json
          error_message: string | null
          expo_ticket_id: string | null
          id: number
          reference_id: string | null
          sent_at: string
          status: string
          title: string
          token: string | null
          trigger_source: string
          user_id: string | null
        }
        Insert: {
          body: string
          data?: Json
          error_message?: string | null
          expo_ticket_id?: string | null
          id?: number
          reference_id?: string | null
          sent_at?: string
          status?: string
          title: string
          token?: string | null
          trigger_source?: string
          user_id?: string | null
        }
        Update: {
          body?: string
          data?: Json
          error_message?: string | null
          expo_ticket_id?: string | null
          id?: number
          reference_id?: string | null
          sent_at?: string
          status?: string
          title?: string
          token?: string | null
          trigger_source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      push_notification_tokens: {
        Row: {
          created_at: string | null
          id: number
          is_active: boolean | null
          platform: string | null
          token: string
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          platform?: string | null
          token: string
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          is_active?: boolean | null
          platform?: string | null
          token?: string
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_notification_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_settings: {
        Row: {
          id: number
          is_active: boolean | null
          milestone_ambassador_count: number | null
          milestone_star_count: number | null
          referee_reward_points: number | null
          referee_signup_credit: number | null
          referee_wallet_credit: number | null
          referrer_first_order_credit: number | null
          referrer_first_order_points: number | null
          referrer_month_credit: number | null
          referrer_reward_points: number | null
          referrer_wallet_credit: number | null
          updated_at: string | null
        }
        Insert: {
          id?: number
          is_active?: boolean | null
          milestone_ambassador_count?: number | null
          milestone_star_count?: number | null
          referee_reward_points?: number | null
          referee_signup_credit?: number | null
          referee_wallet_credit?: number | null
          referrer_first_order_credit?: number | null
          referrer_first_order_points?: number | null
          referrer_month_credit?: number | null
          referrer_reward_points?: number | null
          referrer_wallet_credit?: number | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          is_active?: boolean | null
          milestone_ambassador_count?: number | null
          milestone_star_count?: number | null
          referee_reward_points?: number | null
          referee_signup_credit?: number | null
          referee_wallet_credit?: number | null
          referrer_first_order_credit?: number | null
          referrer_first_order_points?: number | null
          referrer_month_credit?: number | null
          referrer_reward_points?: number | null
          referrer_wallet_credit?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      referrals: {
        Row: {
          created_at: string | null
          first_order_reward_given: boolean | null
          id: number
          month_reward_given: boolean | null
          referee_id: string | null
          referrer_id: string | null
          reward_given: boolean | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          first_order_reward_given?: boolean | null
          id?: number
          month_reward_given?: boolean | null
          referee_id?: string | null
          referrer_id?: string | null
          reward_given?: boolean | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          first_order_reward_given?: boolean | null
          id?: number
          month_reward_given?: boolean | null
          referee_id?: string | null
          referrer_id?: string | null
          reward_given?: boolean | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_referee_id_fkey"
            columns: ["referee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_attendance: {
        Row: {
          branch_id: number | null
          clock_in_lat: number | null
          clock_in_lng: number | null
          clock_in_time: string | null
          clock_out_lat: number | null
          clock_out_lng: number | null
          clock_out_time: string | null
          date: string
          id: number
          staff_id: string | null
        }
        Insert: {
          branch_id?: number | null
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_in_time?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          clock_out_time?: string | null
          date: string
          id?: number
          staff_id?: string | null
        }
        Update: {
          branch_id?: number | null
          clock_in_lat?: number | null
          clock_in_lng?: number | null
          clock_in_time?: string | null
          clock_out_lat?: number | null
          clock_out_lng?: number | null
          clock_out_time?: string | null
          date?: string
          id?: number
          staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_attendance_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leaves: {
        Row: {
          approved_by: string | null
          branch_id: number | null
          created_at: string | null
          end_date: string
          id: number
          reason: string | null
          staff_id: string | null
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          branch_id?: number | null
          created_at?: string | null
          end_date: string
          id?: number
          reason?: string | null
          staff_id?: string | null
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          branch_id?: number | null
          created_at?: string | null
          end_date?: string
          id?: number
          reason?: string | null
          staff_id?: string | null
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_leaves_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leaves_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_leaves_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_order_requests: {
        Row: {
          approved_by: string | null
          branch_id: number | null
          created_at: string
          id: number
          items: Json
          request_type: string
          status: string
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          branch_id?: number | null
          created_at?: string
          id?: number
          items?: Json
          request_type: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          branch_id?: number | null
          created_at?: string
          id?: number
          items?: Json
          request_type?: string
          status?: string
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_order_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_order_requests_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_order_requests_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_salary: {
        Row: {
          base_salary: number
          bonus: number | null
          branch_id: number | null
          created_at: string | null
          deductions: number | null
          id: number
          is_paid: boolean | null
          month: number
          net_salary: number
          paid_at: string | null
          staff_id: string | null
          updated_at: string | null
          year: number
        }
        Insert: {
          base_salary: number
          bonus?: number | null
          branch_id?: number | null
          created_at?: string | null
          deductions?: number | null
          id?: number
          is_paid?: boolean | null
          month: number
          net_salary: number
          paid_at?: string | null
          staff_id?: string | null
          updated_at?: string | null
          year: number
        }
        Update: {
          base_salary?: number
          bonus?: number | null
          branch_id?: number | null
          created_at?: string | null
          deductions?: number | null
          id?: number
          is_paid?: boolean | null
          month?: number
          net_salary?: number
          paid_at?: string | null
          staff_id?: string | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "staff_salary_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_salary_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          branch_id: number | null
          created_at: string | null
          days_of_week: string[] | null
          end_time: string
          id: number
          is_active: boolean | null
          shift_name: string
          staff_id: string | null
          start_time: string
          updated_at: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          days_of_week?: string[] | null
          end_time: string
          id?: number
          is_active?: boolean | null
          shift_name: string
          staff_id?: string | null
          start_time: string
          updated_at?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          days_of_week?: string[] | null
          end_time?: string
          id?: number
          is_active?: boolean | null
          shift_name?: string
          staff_id?: string | null
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      store_config: {
        Row: {
          cancellation_window_hours: number | null
          created_at: string | null
          delivery_fee: number | null
          essentials_module_active: boolean | null
          hub_delivery_active: boolean | null
          id: number
          low_wallet_threshold: number | null
          loyalty_points_per_rupee: number | null
          min_wallet_topup: number | null
          storm_mode_active: boolean | null
          tax_rate_percentage: number | null
          updated_at: string | null
          whatsapp_support_number: string | null
          winback_inactive_days: number | null
        }
        Insert: {
          cancellation_window_hours?: number | null
          created_at?: string | null
          delivery_fee?: number | null
          essentials_module_active?: boolean | null
          hub_delivery_active?: boolean | null
          id?: number
          low_wallet_threshold?: number | null
          loyalty_points_per_rupee?: number | null
          min_wallet_topup?: number | null
          storm_mode_active?: boolean | null
          tax_rate_percentage?: number | null
          updated_at?: string | null
          whatsapp_support_number?: string | null
          winback_inactive_days?: number | null
        }
        Update: {
          cancellation_window_hours?: number | null
          created_at?: string | null
          delivery_fee?: number | null
          essentials_module_active?: boolean | null
          hub_delivery_active?: boolean | null
          id?: number
          low_wallet_threshold?: number | null
          loyalty_points_per_rupee?: number | null
          min_wallet_topup?: number | null
          storm_mode_active?: boolean | null
          tax_rate_percentage?: number | null
          updated_at?: string | null
          whatsapp_support_number?: string | null
          winback_inactive_days?: number | null
        }
        Relationships: []
      }
      subscription_plan_items: {
        Row: {
          id: number
          item_id: number
          item_type: string | null
          plan_id: number | null
          quantity: number | null
        }
        Insert: {
          id?: number
          item_id: number
          item_type?: string | null
          plan_id?: number | null
          quantity?: number | null
        }
        Update: {
          id?: number
          item_id?: number
          item_type?: string | null
          plan_id?: number | null
          quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plan_items_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          branch_id: number | null
          created_at: string | null
          cycle_id: number | null
          duration_days: number
          id: number
          is_active: boolean | null
          plan_items: string | null
          plan_name: string
          plan_type: string | null
          price: number
          savings_amount: number | null
          updated_at: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          duration_days: number
          id?: number
          is_active?: boolean | null
          plan_items?: string | null
          plan_name: string
          plan_type?: string | null
          price: number
          savings_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          cycle_id?: number | null
          duration_days?: number
          id?: number
          is_active?: boolean | null
          plan_items?: string | null
          plan_name?: string
          plan_type?: string | null
          price?: number
          savings_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_plans_cycle_id_fkey"
            columns: ["cycle_id"]
            isOneToOne: false
            referencedRelation: "delivery_cycles"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_batches: {
        Row: {
          branch_id: number | null
          created_at: string
          id: number
          items_snapshot: Json
          note: string | null
          printed_at: string
          printed_by: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string
          id?: number
          items_snapshot?: Json
          note?: string | null
          printed_at?: string
          printed_by?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string
          id?: number
          items_snapshot?: Json
          note?: string | null
          printed_at?: string
          printed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_batches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_batches_printed_by_fkey"
            columns: ["printed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_catalog: {
        Row: {
          category: string
          created_at: string | null
          id: string
          is_active: boolean
          name: string
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          name: string
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      supply_order_items: {
        Row: {
          added_by: string | null
          batch_id: number | null
          branch_id: number | null
          category: string
          created_at: string
          id: number
          name: string
          qty: number
          request_id: number | null
        }
        Insert: {
          added_by?: string | null
          batch_id?: number | null
          branch_id?: number | null
          category: string
          created_at?: string
          id?: number
          name: string
          qty?: number
          request_id?: number | null
        }
        Update: {
          added_by?: string | null
          batch_id?: number | null
          branch_id?: number | null
          category?: string
          created_at?: string
          id?: number
          name?: string
          qty?: number
          request_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supply_order_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_order_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "supply_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_order_items_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_order_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "staff_order_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      user_subscriptions: {
        Row: {
          branch_id: number | null
          created_at: string | null
          days_consumed: number | null
          id: number
          is_active: boolean | null
          is_paused: boolean | null
          payment_method: string | null
          plan_id: number | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          start_date: string
          updated_at: string | null
          user_id: string | null
          wallet_amount_used: number | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string | null
          days_consumed?: number | null
          id?: number
          is_active?: boolean | null
          is_paused?: boolean | null
          payment_method?: string | null
          plan_id?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          start_date: string
          updated_at?: string | null
          user_id?: string | null
          wallet_amount_used?: number | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string | null
          days_consumed?: number | null
          id?: number
          is_active?: boolean | null
          is_paused?: boolean | null
          payment_method?: string | null
          plan_id?: number | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          start_date?: string
          updated_at?: string | null
          user_id?: string | null
          wallet_amount_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string | null
          description: string
          id: number
          reference_id: string | null
          reference_type: string | null
          transaction_type: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          description: string
          id?: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string
          id?: number
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _kitchen_get_secret: { Args: { p_name: string }; Returns: string }
      add_or_merge_supply_order_item: {
        Args: {
          p_added_by: string
          p_branch_id: number
          p_category: string
          p_name: string
          p_qty: number
          p_request_id: number
        }
        Returns: number
      }
      admin_cancel_order_atomic: {
        Args: { p_order_id: number; p_reason?: string; p_refund_amount: number }
        Returns: Json
      }
      admin_cancel_subscription_atomic: {
        Args: { p_refund_amount: number; p_subscription_id: number }
        Returns: Json
      }
      assign_hub_operator: {
        Args: {
          p_hub_id: number
          p_new_user_id?: string
          p_old_user_id?: string
        }
        Returns: undefined
      }
      assign_hub_to_address_ids: {
        Args: { p_address_ids: number[]; p_hub_id: number }
        Returns: undefined
      }
      auth_user_id_by_phone: { Args: { p_phone: string }; Returns: string }
      complete_onboarding_atomic: {
        Args: {
          p_address_line: string
          p_city?: string
          p_full_name: string
          p_hub_id?: number
          p_is_serviceable?: boolean
          p_label: string
          p_landmark?: string
          p_latitude?: number
          p_longitude?: number
          p_phone_number: string
          p_pincode?: string
          p_user_id: string
          p_zone_id?: number
        }
        Returns: number
      }
      complete_wallet_topup: {
        Args: { p_razorpay_order_id: string; p_razorpay_payment_id: string }
        Returns: {
          amount: number
          user_id: string
        }[]
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      decrement_wallet_balance_if_sufficient: {
        Args: { p_amount: number; p_description?: string; p_user_id: string }
        Returns: boolean
      }
      demote_employee: { Args: { target_id: string }; Returns: undefined }
      elevate_to_staff: {
        Args: {
          p_assigned_hub_id: number
          p_benefits: string
          p_branch_id: number
          p_designation: string
          p_full_name: string
          p_joining_bonus: number
          p_joining_date: string
          p_monthly_salary: number
          p_phone_number: string
          p_shift_timing: string
          p_user_id: string
        }
        Returns: string
      }
      generate_daily_manifest: {
        Args: { p_cycle_id?: number; p_target_date?: string }
        Returns: Json
      }
      get_addresses_for_hub_assignment: {
        Args: { p_hub_id: number }
        Returns: {
          id: number
          latitude: number
          longitude: number
          user_id: string
        }[]
      }
      get_hub_impact_addresses: {
        Args: { p_hub_id: number }
        Returns: {
          id: number
          label: string
          user_id: string
          zone_id: number
        }[]
      }
      get_server_time: { Args: never; Returns: string }
      has_branch_access: { Args: { row_branch_id: number }; Returns: boolean }
      increment_loyalty_points: {
        Args: { p_points: number; p_user_id: string }
        Returns: undefined
      }
      increment_wallet_balance: {
        Args: { p_amount: number; p_description?: string; p_user_id: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_staff_or_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      jwt_branch_id: { Args: never; Returns: number }
      jwt_user_role: { Args: never; Returns: string }
      mark_order_failed: {
        Args: { p_razorpay_order_id: string; p_reason?: string }
        Returns: undefined
      }
      mark_order_paid: {
        Args: { p_razorpay_order_id: string; p_razorpay_payment_id: string }
        Returns: {
          order_id: number
          total_amount: number
          user_id: string
        }[]
      }
      place_order_atomic: {
        Args: {
          p_branch_id: number
          p_cycle_id: number
          p_delivery_address_id: number
          p_delivery_fee: number
          p_delivery_method: string
          p_dispatch_date: string
          p_hub_id: number
          p_items: Json
          p_notes: string
          p_order_type: string
          p_payment_method: string
          p_razorpay_order_id: string
          p_status: string
          p_tax_amount: number
          p_total_amount: number
          p_user_id: string
          p_wallet_amount_used: number
        }
        Returns: number
      }
      push_kitchen_summary: {
        Args: { p_cycle_id: number; p_target_date?: string }
        Returns: Json
      }
      set_employee_designation: {
        Args: { new_designation: string; target_id: string }
        Returns: undefined
      }
      trigger_kitchen_cutoff_pushes: { Args: never; Returns: undefined }
      update_employee_profile: {
        Args: { target_id: string; updates: Json }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
